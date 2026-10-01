import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
	CableImportRowSchema,
	DeviceImportRowSchema,
	type ImportResponse,
	type ImportRowResult,
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
	'b_device',
	'b_interface',
	'label',
	'kind',
	'status',
]

const DEVICE_TYPE_CSV_HEADER = [
	'manufacturer_slug',
	'model',
	'u_height',
	'is_full_depth',
	'form_factor',
	'width',
	'description',
]

/** Device-type export: one row per type, manufacturer as slug for re-import. */
export async function exportDeviceTypesCsv(): Promise<string> {
	const db = getDb()
	const rows = await db
		.select({
			manufacturer_slug: manufacturers.slug,
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
			r.manufacturer_slug,
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
 * uses manufacturer names (rather than Conex manufacturer slugs), and one
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
	const rows: ImportRowResult[] = []
	try {
		await withTransaction(async () => {
			for (const [index, definition] of definitions.entries()) {
				rows.push({ row: index + 1, ...(await importDeviceTypeRow(definition)) })
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
async function importDeviceTypeRow(definition: unknown): Promise<Omit<ImportRowResult, 'row'>> {
	try {
		return await withTransaction(async () => {
			const result = await importDeviceTypeDefinition(definition)
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

/** Creates one NetBox device-type definition with its ports. */
async function importDeviceTypeDefinition(
	definition: unknown,
): Promise<Omit<ImportRowResult, 'row'>> {
	const fail = (error: string): Omit<ImportRowResult, 'row'> => ({ ok: false, id: null, error })
	if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
		return fail('Each YAML document must be a mapping')
	}
	const item = definition as Record<string, unknown>
	const manufacturer = typeof item.manufacturer === 'string' ? item.manufacturer.trim() : ''
	const model = typeof item.model === 'string' ? item.model.trim() : ''
	if (!manufacturer || !model) {
		return fail('manufacturer and model are required by NetBox YAML')
	}
	const mfr = (await getDb().select().from(manufacturers)).find(
		(row) => row.name.toLowerCase() === manufacturer.toLowerCase() || row.slug === manufacturer,
	)
	if (!mfr) {
		return {
			...fail(`Unknown manufacturer "${manufacturer}"`),
			unknown_manufacturer: manufacturer,
		}
	}
	const height = item.u_height === undefined ? 1 : Number(item.u_height)
	if (!Number.isInteger(height) || height < 0 || height > 60) {
		return fail('u_height must be an integer between 0 and 60')
	}
	let fullDepth = true
	if (item.is_full_depth !== undefined) {
		if (typeof item.is_full_depth === 'boolean') {
			fullDepth = item.is_full_depth
		} else if (typeof item.is_full_depth === 'number') {
			fullDepth = item.is_full_depth !== 0
		} else if (typeof item.is_full_depth === 'string') {
			const s = item.is_full_depth.trim().toLowerCase()
			if (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === '') {
				fullDepth = true
			} else if (s === 'false' || s === '0' || s === 'no' || s === 'n') {
				fullDepth = false
			} else {
				return fail('is_full_depth must be a boolean (true/false)')
			}
		} else {
			return fail('is_full_depth must be a boolean (true/false)')
		}
	}
	const created = await createDeviceType({
		manufacturer_id: mfr.id,
		model,
		u_height: height,
		is_full_depth: fullDepth,
		description: typeof item.description === 'string' ? item.description : undefined,
		comments: typeof item.comments === 'string' ? item.comments : undefined,
	})
	if (Result.isError(created)) {
		return fail(created.error.message)
	}
	for (const [key, defaultKind] of [
		['interfaces', 'ethernet'],
		['console-ports', 'console'],
		['power-ports', 'power'],
	] as const) {
		const ports = item[key]
		if (!Array.isArray(ports)) {
			continue
		}
		for (const component of ports) {
			if (!component || typeof component !== 'object' || Array.isArray(component)) {
				continue
			}
			const port = component as Record<string, unknown>
			const name = typeof port.name === 'string' ? port.name.trim() : ''
			if (!name) {
				continue
			}
			// NetBox interface types may be a list; the first entry wins.
			// Console/power ports keep their class as kind (the device detail
			// page splits ports on it), dropping the connector type.
			const type = Array.isArray(port.type) ? port.type[0] : port.type
			const stub = await createStub(created.value.id, {
				prefix: name,
				count: 1,
				kind:
					key !== 'interfaces' || type === undefined || type === null
						? defaultKind
						: String(type),
				label:
					key === 'interfaces' && typeof port.label === 'string' ? port.label : undefined,
				description: typeof port.description === 'string' ? port.description : undefined,
			})
			if (Result.isError(stub)) {
				return fail(`${key} "${name}": ${stub.error.message}`)
			}
		}
	}
	return { ok: true, id: created.value.id, error: null }
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
			b_interface: bIface.name,
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
			r.b_device ?? '',
			r.b_interface ?? '',
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
	const typeByModel = new Map((await db.select().from(device_types)).map((r) => [r.model, r.id]))
	const roleByName = new Map((await db.select().from(device_roles)).map((r) => [r.name, r.id]))
	const siteByName = new Map((await db.select().from(sites)).map((r) => [r.name, r]))
	const rackByName = new Map((await db.select().from(racks)).map((r) => [r.name, r]))
	return importCsvRows(text, DeviceImportRowSchema, async (input) => {
		const typeId = typeByModel.get(input.device_type_model)
		if (!typeId) {
			return `Unknown device_type_model "${input.device_type_model}"`
		}
		const roleId = roleByName.get(input.device_role_name)
		if (!roleId) {
			return `Unknown device_role_name "${input.device_role_name}"`
		}
		const site = input.site_name ? siteByName.get(input.site_name) : undefined
		if (input.site_name) {
			if (!site) {
				return `Unknown site_name "${input.site_name}"`
			}
			if (!inScope(site.tenant_id, scopeTenantId)) {
				return `Site "${input.site_name}" is outside your tenant scope`
			}
		}
		const rack = input.rack_name ? rackByName.get(input.rack_name) : undefined
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
	const ifaceByKey = new Map(
		(await db.select().from(interfaces)).map((r) => [`${r.device_id}:${r.name}`, r.id]),
	)
	return importCsvRows(text, CableImportRowSchema, async (input) => {
		const aDev = deviceByName.get(input.a_device)
		if (!aDev) {
			return `Unknown a_device "${input.a_device}"`
		}
		const bDev = deviceByName.get(input.b_device)
		if (!bDev) {
			return `Unknown b_device "${input.b_device}"`
		}
		const aIfaceId = ifaceByKey.get(`${aDev.id}:${input.a_interface}`)
		if (!aIfaceId) {
			return `Device "${input.a_device}" has no interface "${input.a_interface}"`
		}
		const bIfaceId = ifaceByKey.get(`${bDev.id}:${input.b_interface}`)
		if (!bIfaceId) {
			return `Device "${input.b_device}" has no interface "${input.b_interface}"`
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
