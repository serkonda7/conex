import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
	CableImportRowSchema,
	DeviceImportRowSchema,
	DeviceTypeYamlSchema,
	DISPLAY_PORT_KINDS,
	GENERAL_PORT_KINDS,
	type ImportResponse,
	type ImportRowResult,
	NETBOX_INTERFACE_TYPES,
	PASS_THROUGH_PORT_TYPES,
	type PortSide,
} from 'shared/src/schemas'
import * as v from 'valibot'
import {
	cables,
	device_roles,
	device_types,
	devices,
	interfaces,
	manufacturers,
	racks,
	sites,
} from '../schema'
import { collapseRuns, expandNameTemplate } from '../services/templates'
import { parseCsv, rowsToObjects, toCsv } from '../util/csv'
import { formatValibotIssues } from '../util/valibot'
import { cableInTenant, connectCable } from './cables'
import { getDb, withTransaction } from './connection'
import { createDevice } from './devices'
import { errOf } from './list'
import { createDeviceType, createStub } from './templates'

const DEVICE_CSV_HEADER = [
	'name',
	'asset_tag',
	'device_id',
	'device_type_model',
	'device_role_name',
	'site_name',
	'rack_name',
	'position_u',
	'status',
]

const CABLE_CSV_HEADER = [
	'a_device',
	'a_interface',
	'a_side',
	'b_device',
	'b_interface',
	'b_side',
	'label',
	'kind',
	'status',
]

const DEVICE_TYPE_CSV_HEADER = [
	'manufacturer',
	'model',
	'u_height',
	'is_full_depth',
	'form_factor',
	'width',
	'description',
]

/** Device-type export: one row per type, manufacturer as name for re-import. */
export async function exportDeviceTypesCsv(): Promise<string> {
	const db = getDb()
	const rows = await db
		.select({
			manufacturer: manufacturers.name,
			model: device_types.model,
			u_height: device_types.u_height,
			is_full_depth: device_types.is_full_depth,
			form_factor: device_types.form_factor,
			width: device_types.width,
			description: device_types.description,
			comments: device_types.comments,
		})
		.from(device_types)
		.leftJoin(manufacturers, eq(device_types.manufacturer_id, manufacturers.id))
		.orderBy(device_types.model)
	return toCsv(
		DEVICE_TYPE_CSV_HEADER,
		rows.map((r) => [
			r.manufacturer,
			r.model,
			String(r.u_height),
			r.is_full_depth ? 'true' : 'false',
			r.form_factor,
			r.width === null ? null : String(r.width),
			r.description,
		]),
	)
}

/** Thrown inside the import transaction to roll back after a failed row. */
class ImportRollback extends Error {}

/**
 * Imports the device-type YAML used by NetBox's device-type library. NetBox
 * uses manufacturer names, and one
 * YAML document represents one device type. A YAML sequence is accepted too,
 * which makes pasting a collection of library definitions convenient.
 *
 * All-or-nothing: every row is validated and reported, but if any row fails
 * the whole import is rolled back and the rows that would have succeeded come
 * back as `ok: false` with no error.
 */
export async function importDeviceTypesYaml(text: string): Promise<Result<ImportResponse, Error>> {
	let parsed: unknown
	try {
		parsed = Bun.YAML.parse(text)
	} catch (error) {
		return Result.err(new Error(`Invalid YAML: ${errOf(error).message}`))
	}
	const definitions = Array.isArray(parsed) ? parsed : [parsed]
	// Snapshot before the transaction so models created by earlier rows of
	// this import count as in-file duplicates, not as existing types.
	const existing = new Map(
		(await getDb().select().from(device_types)).map((r) => [
			typeKey(r.manufacturer_id, r.model),
			r.id,
		]),
	)
	const manufacturerByName = new Map(
		(await getDb().select().from(manufacturers)).map((r) => [matchKey(r.name), r]),
	)
	const roleByName = new Map(
		(await getDb().select().from(device_roles)).map((r) => [matchKey(r.name), r.id]),
	)
	const lookups: DeviceTypeLookups = {
		existing,
		seen: new Set<string>(),
		manufacturerByName,
		roleByName,
	}
	const rows: ImportRowResult[] = []
	try {
		await withTransaction(async () => {
			for (const [index, definition] of definitions.entries()) {
				rows.push({
					row: index + 1,
					...(await importDeviceTypeRow(definition, lookups)),
				})
			}
			if (rows.some((r) => !r.ok)) {
				throw new ImportRollback()
			}
		})
	} catch (err) {
		if (!(err instanceof ImportRollback)) {
			return Result.err(errOf(err))
		}
		for (const r of rows) {
			if (r.ok) {
				r.ok = false
				r.id = null
			}
		}
	}
	return Result.ok(importResult(rows))
}

/** Thrown inside a row savepoint to undo a partially created definition. */
class RowRollback extends Error {
	constructor(readonly result: Omit<ImportRowResult, 'row'>) {
		super(result.error ?? 'Row failed')
	}
}

/**
 * One definition in its own savepoint: Postgres aborts the transaction on a
 * failed statement, so without it every later row would only report
 * "current transaction is aborted" instead of its own validation result.
 */
async function importDeviceTypeRow(
	definition: unknown,
	lookups: DeviceTypeLookups,
): Promise<Omit<ImportRowResult, 'row'>> {
	try {
		return await withTransaction(async () => {
			const result = await importDeviceTypeDefinition(definition, lookups)
			if (!result.ok) {
				throw new RowRollback(result)
			}
			return result
		})
	} catch (err) {
		if (err instanceof RowRollback) {
			return err.result
		}
		throw err
	}
}

/** Lookups shared by all rows of one device-type YAML import. */
interface DeviceTypeLookups {
	/** Existing types by `typeKey`, snapshotted before the import. */
	existing: Map<string, number>
	/** `typeKey`s already seen in this import. */
	seen: Set<string>
	manufacturerByName: Map<string, typeof manufacturers.$inferSelect>
	roleByName: Map<string, number>
}

/** Device-type identity: a model is unique per manufacturer, not globally. */
function typeKey(manufacturerId: number, model: string): string {
	return `${manufacturerId}:${matchKey(model)}`
}

/** Name-matching key: names match case-insensitively and ignore surrounding whitespace. */
function matchKey(name: string): string {
	return name.trim().toLowerCase()
}

/**
 * Creates one NetBox device-type definition with its ports. Models are
 * unique per manufacturer; the same model name from another vendor is a
 * different type.
 */
async function importDeviceTypeDefinition(
	definition: unknown,
	lookups: DeviceTypeLookups,
): Promise<Omit<ImportRowResult, 'row'>> {
	const { existing, seen } = lookups
	const fail = (error: string): Omit<ImportRowResult, 'row'> => ({ ok: false, id: null, error })
	const parsed = v.safeParse(DeviceTypeYamlSchema, definition)
	if (!parsed.success) {
		return fail(formatValibotIssues(parsed.issues))
	}
	const item = parsed.output
	const mfr = lookups.manufacturerByName.get(matchKey(item.manufacturer))
	if (!mfr) {
		return fail(`Unknown manufacturer "${item.manufacturer}"`)
	}
	const modelKey = typeKey(mfr.id, item.model)
	const existingId = existing.get(modelKey)
	if (existingId !== undefined) {
		return {
			...fail('Already exists'),
			existing_device_type: { id: existingId, model: item.model },
		}
	}
	if (seen.has(modelKey)) {
		return fail('Duplicate in this import')
	}
	seen.add(modelKey)
	// conex extension: optional role preselected for devices of this type,
	// matched by name like the manufacturer.
	let defaultRoleId: number | null = null
	if (item.default_device_role) {
		const roleId = lookups.roleByName.get(matchKey(item.default_device_role))
		if (roleId === undefined) {
			return fail(`Unknown default_device_role "${item.default_device_role}"`)
		}
		defaultRoleId = roleId
	}
	const created = await createDeviceType({
		manufacturer_id: mfr.id,
		model: item.model,
		u_height: item.u_height,
		is_full_depth: item.is_full_depth,
		default_device_role_id: defaultRoleId,
		part_number: item.part_number ?? undefined,
		spec_url: item.spec_url ?? undefined,
		description: item.description ?? undefined,
		comments: item.comments ?? undefined,
	})
	if (Result.isError(created)) {
		return fail(created.error.message)
	}
	const passThrough = await importPassThroughPorts(created.value.id, item)
	if (passThrough !== null) {
		return fail(passThrough)
	}
	// Allowed NetBox `type` values per list (`null`: not checked). A missing
	// type takes the list's default kind; a `null` default means required.
	const componentLists: Array<[string, string | null, readonly string[] | null]> = [
		['interfaces', 'ethernet', Object.keys(NETBOX_INTERFACE_TYPES)],
		['ports', 'port', [...GENERAL_PORT_KINDS, 'other']],
		// NetBox's name for general ports.
		['console-ports', 'port', [...GENERAL_PORT_KINDS, 'other']],
		['power-ports', 'power', null],
		['power-outlets', 'power-outlet', null],
		['display-ports', null, DISPLAY_PORT_KINDS],
	]
	const groups = new Map<
		string,
		{
			key: string
			kind: string
			label: string | undefined
			description: string | undefined
			names: string[]
		}
	>()
	for (const [key, defaultKind, allowed] of componentLists) {
		const components = componentsOf(key, item[key])
		if (Result.isError(components)) {
			return fail(components.error.message)
		}
		for (const port of components.value) {
			const name = nameOf(port)
			if (!name) {
				return fail(`${key}: entry without a name`)
			}
			// NetBox interface types may be a list; the first entry wins.
			// Ports keep a known connector type (usb-c, rj-45, …) as kind;
			// `other` is stored as the plain `port`. Any other type is an error.
			// Power ports and outlets keep their class as kind (the device
			// detail page splits ports on it), dropping the connector type.
			// Display ports (not a NetBox class) keep their connector type as
			// kind.
			const type = Array.isArray(port.type) ? port.type[0] : port.type
			let kind: string | null = defaultKind
			if (allowed !== null && type !== undefined && type !== null) {
				if (typeof type !== 'string' || !allowed.includes(type)) {
					return fail(`${key} "${name}": type must be one of ${allowed.join(', ')}`)
				}
				kind = type === 'other' && key !== 'interfaces' ? 'port' : type
			}
			if (kind === null) {
				return fail(`${key} "${name}": type is required`)
			}
			const names = expandNameTemplate(name)
			if (Result.isError(names)) {
				return fail(`${key} "${name}": ${names.error.message}`)
			}
			const label =
				key === 'interfaces' && typeof port.label === 'string' ? port.label : undefined
			const description = typeof port.description === 'string' ? port.description : undefined
			// A stub carries one kind, label and description, so ports only
			// collapse into one stub when all three match.
			const groupKey = JSON.stringify([key, kind, label ?? null, description ?? null])
			const group = groups.get(groupKey) ?? {
				key,
				kind,
				label,
				description,
				names: [],
			}
			group.names.push(...names.value)
			groups.set(groupKey, group)
		}
	}
	for (const group of groups.values()) {
		for (const run of collapseRuns(group.names)) {
			const stub = await createStub(created.value.id, {
				prefix: run.prefix,
				count: run.count,
				kind: group.kind,
				label: group.label,
				description: group.description,
			})
			if (Result.isError(stub)) {
				return fail(`${group.key} "${run.prefix}": ${stub.error.message}`)
			}
		}
	}
	return { ok: true, id: created.value.id, error: null }
}

/** Mappings of one YAML component list; any other entry is an error. */
function componentsOf(key: string, list: unknown): Result<Record<string, unknown>[], Error> {
	if (list === undefined) {
		return Result.ok([])
	}
	if (!Array.isArray(list)) {
		return Result.err(new Error(`${key} must be a list`))
	}
	const mappings: Record<string, unknown>[] = []
	for (const entry of list) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			return Result.err(new Error(`${key}: entries must be mappings`))
		}
		mappings.push(entry as Record<string, unknown>)
	}
	return Result.ok(mappings)
}

/** Trimmed `name` of a YAML port entry, or an empty string when missing. */
function nameOf(port: Record<string, unknown>): string {
	return typeof port.name === 'string' ? port.name.trim() : ''
}

/** NetBox port type (`8p8c`, `lc`, `mpo`, …) as the stored kind; null when not a known pass-through type. */
function passThroughKindOf(port: Record<string, unknown>): string | null {
	const type = typeof port.type === 'string' ? port.type.trim() : ''
	return Object.keys(PASS_THROUGH_PORT_TYPES).includes(type) ? type : null
}

/**
 * NetBox `rear-ports` (`{name, type, positions}`) and `front-ports`
 * (`{name, type, rear_port, rear_port_position}`): each port becomes a
 * single-port stub, a front port mapped onto the rear port of that name in
 * the same document at an explicit position (inline, or via NetBox 4.3+
 * `port-mappings`). Rear ports come first so the front ports can reference
 * them. Answers the failure message, or null.
 */
async function importPassThroughPorts(
	deviceTypeId: number,
	item: Record<string, unknown>,
): Promise<string | null> {
	const rearByName = new Map<string, number>()
	const rears = componentsOf('rear-ports', item['rear-ports'])
	if (Result.isError(rears)) {
		return rears.error.message
	}
	for (const port of rears.value) {
		const name = nameOf(port)
		if (!name) {
			return 'rear-ports: entry without a name'
		}
		const positions = port.positions === undefined ? 1 : Number(port.positions)
		if (!Number.isInteger(positions) || positions < 1) {
			return `rear-ports "${name}": positions must be an integer of at least 1`
		}
		const kind = passThroughKindOf(port)
		if (kind === null) {
			return `rear-ports "${name}": type must be one of ${Object.keys(PASS_THROUGH_PORT_TYPES).join(', ')}`
		}
		const names = expandNameTemplate(name)
		if (Result.isError(names)) {
			return `rear-ports "${name}": ${names.error.message}`
		}
		for (const prefix of names.value) {
			const stub = await createStub(deviceTypeId, {
				prefix,
				count: 1,
				kind,
				label: typeof port.label === 'string' ? port.label : undefined,
				description: typeof port.description === 'string' ? port.description : undefined,
				side: 'rear',
				positions,
			})
			if (Result.isError(stub)) {
				return `rear-ports "${prefix}": ${stub.error.message}`
			}
			rearByName.set(prefix, stub.value.id)
		}
	}
	// NetBox 4.3+ moves the mapping out of the front port into a top-level
	// `port-mappings` list (`{front_port, front_port_position, rear_port,
	// rear_port_position}`); the first mapping of a front port wins.
	const mappingByFront = new Map<string, Record<string, unknown>>()
	const mappings = componentsOf('port-mappings', item['port-mappings'])
	if (Result.isError(mappings)) {
		return mappings.error.message
	}
	for (const mapping of mappings.value) {
		const front = typeof mapping.front_port === 'string' ? mapping.front_port.trim() : ''
		if (front && !mappingByFront.has(front)) {
			mappingByFront.set(front, mapping)
		}
	}
	const fronts = componentsOf('front-ports', item['front-ports'])
	if (Result.isError(fronts)) {
		return fronts.error.message
	}
	for (const port of fronts.value) {
		const name = nameOf(port)
		if (!name) {
			return 'front-ports: entry without a name'
		}
		const names = expandNameTemplate(name)
		if (Result.isError(names)) {
			return `front-ports "${name}": ${names.error.message}`
		}
		// A front port takes one rear slot, so a name template cannot expand.
		if (names.value.length !== 1) {
			return `front-ports "${name}": name templates are not supported on front ports`
		}
		const source = port.rear_port === undefined ? (mappingByFront.get(name) ?? port) : port
		const rearName = typeof source.rear_port === 'string' ? source.rear_port.trim() : ''
		const rearId = rearByName.get(rearName)
		if (rearId === undefined) {
			return `front-ports "${name}": unknown rear_port "${rearName}"`
		}
		const position =
			source.rear_port_position === undefined ? 1 : Number(source.rear_port_position)
		if (!Number.isInteger(position) || position < 1) {
			return `front-ports "${name}": rear_port_position must be an integer of at least 1`
		}
		const kind = passThroughKindOf(port)
		if (kind === null) {
			return `front-ports "${name}": type must be one of ${Object.keys(PASS_THROUGH_PORT_TYPES).join(', ')}`
		}
		const stub = await createStub(deviceTypeId, {
			prefix: names.value[0] ?? name,
			count: 1,
			kind,
			label: typeof port.label === 'string' ? port.label : undefined,
			description: typeof port.description === 'string' ? port.description : undefined,
			side: 'front',
			rear_stub_id: rearId,
			rear_position: position,
		})
		if (Result.isError(stub)) {
			return `front-ports "${name}": ${stub.error.message}`
		}
	}
	return null
}

/** Devices export: one row per device, names for the FK columns. */
export async function exportDevicesCsv(scopeTenantId?: number): Promise<string> {
	const db = getDb()
	const scopeCond = scopeTenantId === undefined ? undefined : eq(devices.tenant_id, scopeTenantId)
	const rows = await db
		.select({
			name: devices.name,
			asset_tag: devices.asset_tag,
			device_id: devices.device_id,
			type_model: device_types.model,
			role_name: device_roles.name,
			site_name: sites.name,
			rack_name: racks.name,
			position_u: devices.position_u,
			status: devices.status,
		})
		.from(devices)
		.leftJoin(device_types, eq(devices.device_type_id, device_types.id))
		.leftJoin(device_roles, eq(devices.device_role_id, device_roles.id))
		.leftJoin(sites, eq(devices.site_id, sites.id))
		.leftJoin(racks, eq(devices.rack_id, racks.id))
		.where(scopeCond)
		.orderBy(devices.name)
	return toCsv(
		DEVICE_CSV_HEADER,
		rows.map((r) => [
			r.name,
			r.asset_tag,
			r.device_id,
			r.type_model,
			r.role_name,
			r.site_name,
			r.rack_name,
			r.position_u === null ? null : String(r.position_u),
			r.status,
		]),
	)
}

/** Cables export: endpoint device/interface names plus label/kind/status. */
export async function exportCablesCsv(scopeTenantId?: number): Promise<string> {
	const aIface = alias(interfaces, 'a_iface')
	const bIface = alias(interfaces, 'b_iface')
	const aDevice = alias(devices, 'a_device')
	const bDevice = alias(devices, 'b_device')
	// All cables (no page cap); the scope filter keeps both ends in the
	// tenant so no peer name from another tenant leaks.
	const rows = await getDb()
		.select({
			a_device: aDevice.name,
			a_interface: aIface.name,
			b_device: bDevice.name,
			a_side: aIface.side,
			b_interface: bIface.name,
			b_side: bIface.side,
			label: cables.label,
			kind: cables.kind,
			status: cables.status,
		})
		.from(cables)
		.leftJoin(aIface, eq(aIface.id, cables.a_interface_id))
		.leftJoin(aDevice, eq(aDevice.id, aIface.device_id))
		.leftJoin(bIface, eq(bIface.id, cables.b_interface_id))
		.leftJoin(bDevice, eq(bDevice.id, bIface.device_id))
		.where(scopeTenantId === undefined ? undefined : cableInTenant(scopeTenantId))
		.orderBy(cables.id)
	return toCsv(
		CABLE_CSV_HEADER,
		rows.map((r) => [
			r.a_device ?? '',
			r.a_interface ?? '',
			r.a_side,
			r.b_device ?? '',
			r.b_interface ?? '',
			r.b_side,
			r.label,
			r.kind,
			r.status,
		]),
	)
}

function importResult(rows: ImportRowResult[]): ImportResponse {
	return {
		created: rows.filter((r) => r.ok).length,
		failed: rows.filter((r) => r.error !== null).length,
		rows,
	}
}

/**
 * Shared CSV import loop: validates each row with `schema` and hands it to
 * `importRow`, which answers with the created row or a failure message. One
 * bad row fails only itself; the response reports per-row errors.
 */
async function importCsvRows<S extends v.GenericSchema>(
	text: string,
	schema: S,
	importRow: (input: v.InferOutput<S>) => Promise<string | Result<{ id: number }, Error>>,
): Promise<Result<ImportResponse, Error>> {
	const parsed = parseCsv(text)
	if (Result.isError(parsed)) {
		return parsed
	}
	const rows: ImportRowResult[] = []
	for (const [index, obj] of rowsToObjects(parsed.value.header, parsed.value.rows).entries()) {
		const row = index + 2
		const validated = v.safeParse(schema, obj)
		const outcome = validated.success
			? await importRow(validated.output)
			: formatValibotIssues(validated.issues)
		if (typeof outcome === 'string') {
			rows.push({ row, ok: false, id: null, error: outcome })
		} else if (Result.isError(outcome)) {
			rows.push({ row, ok: false, id: null, error: outcome.error.message })
		} else {
			rows.push({ row, ok: true, id: outcome.value.id, error: null })
		}
	}
	return Result.ok(importResult(rows))
}

/** Strict scope check: exactly the scope tenant, no shared rows. */
function inScope(tenant: number | null, scope: number | undefined): boolean {
	return scope === undefined || tenant === scope
}

/**
 * Devices import: resolves names to ids and creates the device (stub
 * expansion included).
 *
 * `scopeTenantId` serves scoped editors: rows referencing a site/rack
 * outside the scope (or shared rows they may not claim) fail per-row, and
 * created devices are forced into the scope tenant.
 */
export async function importDevicesCsv(
	text: string,
	scopeTenantId?: number,
): Promise<Result<ImportResponse, Error>> {
	const db = getDb()
	const typesByModel = new Map<string, number[]>()
	for (const r of await db.select().from(device_types)) {
		typesByModel.set(matchKey(r.model), [...(typesByModel.get(matchKey(r.model)) ?? []), r.id])
	}
	const roleByName = new Map(
		(await db.select().from(device_roles)).map((r) => [matchKey(r.name), r.id]),
	)
	const siteByName = new Map((await db.select().from(sites)).map((r) => [matchKey(r.name), r]))
	const rackByName = new Map((await db.select().from(racks)).map((r) => [matchKey(r.name), r]))
	return importCsvRows(text, DeviceImportRowSchema, async (input) => {
		const typeIds = typesByModel.get(matchKey(input.device_type_model)) ?? []
		if (typeIds.length === 0) {
			return `Unknown device_type_model "${input.device_type_model}"`
		}
		if (typeIds.length > 1) {
			return `Ambiguous device_type_model "${input.device_type_model}": ${typeIds.length} device types share this model`
		}
		const [typeId] = typeIds
		const roleId = roleByName.get(matchKey(input.device_role_name))
		if (!roleId) {
			return `Unknown device_role_name "${input.device_role_name}"`
		}
		const site = input.site_name ? siteByName.get(matchKey(input.site_name)) : undefined
		if (input.site_name) {
			if (!site) {
				return `Unknown site_name "${input.site_name}"`
			}
			if (!inScope(site.tenant_id, scopeTenantId)) {
				return `Site "${input.site_name}" is outside your tenant scope`
			}
		}
		const rack = input.rack_name ? rackByName.get(matchKey(input.rack_name)) : undefined
		if (input.rack_name) {
			if (!rack) {
				return `Unknown rack_name "${input.rack_name}"`
			}
			if (!inScope(rack.tenant_id, scopeTenantId)) {
				return `Rack "${input.rack_name}" is outside your tenant scope`
			}
		}
		return createDevice({
			device_type_id: typeId,
			device_role_id: roleId,
			name: input.name,
			status: input.status,
			site_id: site?.id,
			rack_id: rack?.id,
			position_u: input.position_u,
			asset_tag: input.asset_tag,
			device_id: input.device_id,
			...(scopeTenantId !== undefined ? { tenant_id: scopeTenantId } : {}),
		})
	})
}

/**
 * Cables import: resolves device/interface names to ids and connects the
 * free ports.
 *
 * `scopeTenantId` serves scoped editors: rows whose endpoint devices are
 * not both in the scope tenant fail per-row, mirroring the cable write
 * rule in `authz.ts`.
 */
export async function importCablesCsv(
	text: string,
	scopeTenantId?: number,
): Promise<Result<ImportResponse, Error>> {
	const db = getDb()
	const deviceByName = new Map((await db.select().from(devices)).map((r) => [r.name, r]))
	// Port names are unique per device and side, so one name may resolve to
	// a normal, a front and a rear port of the same device.
	const ifacesByKey = new Map<string, (typeof interfaces.$inferSelect)[]>()
	for (const r of await db.select().from(interfaces)) {
		const key = `${r.device_id}:${r.name}`
		ifacesByKey.set(key, [...(ifacesByKey.get(key) ?? []), r])
	}
	/** Port id for one cable end, or the failure message. */
	const resolve = (
		end: 'a' | 'b',
		deviceId: number,
		deviceName: string,
		name: string,
		side: PortSide | undefined,
	): number | string => {
		const matches = (ifacesByKey.get(`${deviceId}:${name}`) ?? []).filter(
			(r) => side === undefined || r.side === side,
		)
		const [match] = matches
		if (!match) {
			return side === undefined
				? `Device "${deviceName}" has no interface "${name}"`
				: `Device "${deviceName}" has no ${side} port "${name}"`
		}
		if (matches.length > 1) {
			return `Interface "${name}" of device "${deviceName}" is ambiguous; set ${end}_side`
		}
		return match.id
	}
	return importCsvRows(text, CableImportRowSchema, async (input) => {
		const aDev = deviceByName.get(input.a_device)
		if (!aDev) {
			return `Unknown a_device "${input.a_device}"`
		}
		const bDev = deviceByName.get(input.b_device)
		if (!bDev) {
			return `Unknown b_device "${input.b_device}"`
		}
		const aIfaceId = resolve('a', aDev.id, input.a_device, input.a_interface, input.a_side)
		if (typeof aIfaceId === 'string') {
			return aIfaceId
		}
		const bIfaceId = resolve('b', bDev.id, input.b_device, input.b_interface, input.b_side)
		if (typeof bIfaceId === 'string') {
			return bIfaceId
		}
		if (!inScope(aDev.tenant_id, scopeTenantId) || !inScope(bDev.tenant_id, scopeTenantId)) {
			return 'Cable endpoints are outside your tenant scope'
		}
		return connectCable({
			a_interface_id: aIfaceId,
			b_interface_id: bIfaceId,
			status: input.status,
			kind: input.kind,
			label: input.label,
		})
	})
}
