import { Result } from 'better-result'
import { eq } from 'drizzle-orm'
import {
	DEVICE_TYPE_UPDATE_FIELDS,
	DEVICE_TYPE_UPDATE_PORT_FIELDS,
	type DeviceTypeUpdate,
	type DeviceTypeUpdateApply,
	type DeviceTypeUpdateChange,
	type DeviceTypeUpdatePort,
	type DeviceTypeUpdatePreview,
	type DeviceTypeYamlExport,
	DeviceTypeYamlSchema,
	DISPLAY_PORT_KINDS,
	type ExpandedInterface,
	GENERAL_PORT_KINDS,
	NETBOX_INTERFACE_TYPES,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { device_roles, devices, manufacturers } from '../schema'
import { expandNameTemplate, expandStub, expandStubs } from '../services/templates'
import { formatValibotIssues } from '../util/valibot'
import { getDb, withTransaction } from './connection'
import { createImportedStubs, matchKey } from './csv_transfer'
import { ConflictError, ValidationError } from './errors'
import { errOf } from './list'
import {
	type DeviceTypeRow,
	deleteStub,
	getDeviceType,
	getManufacturer,
	stubsOf,
	updateDeviceType,
} from './templates'

/**
 * Updates an existing device type from re-generated YAML. The YAML is merged
 * over the type's own definition, so a key the AI left out keeps its value.
 * Previews run the real write and roll it back, so they report exactly what
 * applying does, including every refusal.
 */

type YamlEntry = Record<string, unknown>

const PORT_LISTS = [
	'interfaces',
	'ports',
	'power-ports',
	'power-outlets',
	'display-ports',
	'rear-ports',
	'front-ports',
] as const

type PortList = (typeof PORT_LISTS)[number]

const OUTLET_KIND = 'power-outlet'
const POWER_KIND = 'power'

/** One concrete port of a type, with what its stub adds to the expansion. */
interface TypePort extends ExpandedInterface {
	rear_name: string | null
	maximum_draw: number | null
	poe_mode: string | null
	poe_type: string | null
}

const keyOf = (port: { side: string | null; name: string }): string =>
	`${port.side ?? ''}:${port.name}`

function isMapping(value: unknown): value is YamlEntry {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every port the stubs expand to; a type that cannot expand answers an error. */
function portsOf(stubs: Awaited<ReturnType<typeof stubsOf>>): Result<TypePort[], Error> {
	const expanded = expandStubs(stubs)
	if (Result.isError(expanded)) {
		return Result.err(new ConflictError(expanded.error.message))
	}
	const stubByPort = new Map(
		stubs.flatMap((stub) => {
			const names = expandStub(stub.prefix, stub.count)
			return Result.isOk(names)
				? names.value.map((name) => [keyOf({ side: stub.side, name }), stub] as const)
				: []
		}),
	)
	return Result.ok(
		expanded.value.map((port) => {
			const stub = stubByPort.get(keyOf(port))
			return {
				...port,
				rear_name:
					port.rear_index === null
						? null
						: (expanded.value[port.rear_index]?.name ?? null),
				maximum_draw: stub?.maximum_draw ?? null,
				poe_mode: stub?.poe_mode ?? null,
				poe_type: stub?.poe_type ?? null,
			}
		}),
	)
}

/** YAML list a port is exported to; kinds of no other class are interfaces. */
function listOf(port: TypePort): PortList {
	if (port.side !== null) {
		return port.side === 'rear' ? 'rear-ports' : 'front-ports'
	}
	if (port.kind === 'port' || (GENERAL_PORT_KINDS as readonly string[]).includes(port.kind)) {
		return 'ports'
	}
	if ((DISPLAY_PORT_KINDS as readonly string[]).includes(port.kind)) {
		return 'display-ports'
	}
	if (port.kind === OUTLET_KIND || port.kind.startsWith(`${OUTLET_KIND}-`)) {
		return 'power-outlets'
	}
	if (port.kind === POWER_KIND || port.kind.startsWith(`${POWER_KIND}-`)) {
		return 'power-ports'
	}
	return 'interfaces'
}

/** NetBox `type` the importer turns back into the kind; undefined takes the list's default. */
function yamlTypeOf(port: TypePort, list: PortList): string | undefined {
	switch (list) {
		case 'interfaces':
			return port.kind in NETBOX_INTERFACE_TYPES ? port.kind : undefined
		case 'ports':
			return port.kind === 'port' ? 'other' : port.kind
		case 'power-ports':
			return port.kind === POWER_KIND ? undefined : port.kind.slice(POWER_KIND.length + 1)
		case 'power-outlets':
			return port.kind === OUTLET_KIND ? undefined : port.kind.slice(OUTLET_KIND.length + 1)
		default:
			return port.kind
	}
}

/** Keeps only the set values, so the YAML stays free of `null` noise. */
function compact(entry: YamlEntry): YamlEntry {
	return Object.fromEntries(
		Object.entries(entry).filter(([, value]) => value !== null && value !== undefined),
	)
}

function portEntry(port: TypePort, list: PortList): YamlEntry {
	return compact({
		name: port.name,
		type: yamlTypeOf(port, list),
		positions: port.side === 'rear' ? port.positions : undefined,
		maximum_draw: port.maximum_draw,
		poe_mode: port.poe_mode,
		poe_type: port.poe_type,
	})
}

/** A type in the importer's YAML shape; importing it reproduces the type. */
function definitionOf(
	type: DeviceTypeRow,
	manufacturer: string,
	role: string | null,
	ports: TypePort[],
): YamlEntry {
	const definition = compact({
		manufacturer,
		model: type.model,
		u_height: type.u_height,
		is_full_depth: type.is_full_depth,
		default_device_role: role,
		part_number: type.part_number,
		spec_url: type.spec_url,
		eol_date: type.eol_date,
		description: type.description,
		comments: type.comments,
	})
	for (const list of PORT_LISTS) {
		const entries = ports.filter((port) => listOf(port) === list)
		if (entries.length > 0) {
			definition[list] = entries.map((port) => portEntry(port, list))
		}
	}
	const mappings = ports.flatMap((port) =>
		port.rear_name === null
			? []
			: [
					{
						front_port: port.name,
						front_port_position: 1,
						rear_port: port.rear_name,
						rear_port_position: port.rear_port_position,
					},
				],
	)
	if (mappings.length > 0) {
		definition['port-mappings'] = mappings
	}
	return definition
}

/** The current state of a type; `revision` changes with anything an update touches. */
interface TypeSnapshot {
	type: DeviceTypeRow
	definition: YamlEntry
	ports: TypePort[]
	revision: string
}

async function snapshotOf(id: number): Promise<Result<TypeSnapshot, Error>> {
	const type = await getDeviceType(id)
	if (Result.isError(type)) {
		return type
	}
	const manufacturer = await getManufacturer(type.value.manufacturer_id)
	if (Result.isError(manufacturer)) {
		return manufacturer
	}
	const roleId = type.value.default_device_role_id
	const roles =
		roleId === null
			? []
			: await getDb()
					.select({ name: device_roles.name })
					.from(device_roles)
					.where(eq(device_roles.id, roleId))
	const ports = portsOf(await stubsOf(id))
	if (Result.isError(ports)) {
		return ports
	}
	const definition = definitionOf(
		type.value,
		manufacturer.value.name,
		roles[0]?.name ?? null,
		ports.value,
	)
	return Result.ok({
		type: type.value,
		definition,
		ports: ports.value,
		revision: Bun.hash(JSON.stringify(definition)).toString(),
	})
}

export async function exportDeviceTypeYaml(
	id: number,
): Promise<Result<DeviceTypeYamlExport, Error>> {
	const snapshot = await snapshotOf(id)
	if (Result.isError(snapshot)) {
		return snapshot
	}
	return Result.ok({ yaml: `---\n${Bun.YAML.stringify(snapshot.value.definition, null, 2)}\n` })
}

/** The one definition in `text`; updates target one type, so a collection is refused. */
function parseDefinition(text: string): Result<YamlEntry, Error> {
	let parsed: unknown
	try {
		parsed = Bun.YAML.parse(text)
	} catch (error) {
		return Result.err(new ValidationError(`Invalid YAML: ${errOf(error).message}`))
	}
	const definition = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed
	return isMapping(definition)
		? Result.ok(definition)
		: Result.err(new ValidationError('The YAML must contain exactly one device type'))
}

/**
 * The incoming list over the current one: the listed ports are all that remain
 * (so a dropped port is removed), but each keeps the attributes its entry left
 * out. Name templates expand first, as current entries are per port.
 */
function mergePorts(current: unknown, incoming: unknown[]): unknown[] {
	const list = Array.isArray(current) ? current.filter(isMapping) : []
	const byName = new Map(list.map((entry) => [entry.name, entry]))
	return incoming.flatMap((entry) => {
		if (!isMapping(entry) || typeof entry.name !== 'string') {
			return [entry]
		}
		const names = expandNameTemplate(entry.name.trim())
		if (Result.isError(names)) {
			return [entry]
		}
		return names.value.map((name) => ({ ...byName.get(name), ...entry, name }))
	})
}

/** Incoming mappings win per front port; the importer ignores any left over. */
function mergeMappings(current: unknown, incoming: unknown[]): unknown[] {
	const fronts = new Set(incoming.filter(isMapping).map((entry) => entry.front_port))
	const kept = Array.isArray(current)
		? current.filter(isMapping).filter((entry) => !fronts.has(entry.front_port))
		: []
	return [...incoming, ...kept]
}

/** The update over the current definition: an omitted key keeps its value. */
function mergeDefinition(current: YamlEntry, rawUpdate: YamlEntry): YamlEntry {
	const { 'console-ports': consolePorts, ...update } = rawUpdate
	if (Array.isArray(consolePorts)) {
		update.ports = [...(Array.isArray(update.ports) ? update.ports : []), ...consolePorts]
	} else if (consolePorts !== undefined) {
		// Reaches the importer, which reports a list of the wrong shape.
		update['console-ports'] = consolePorts
	}
	const merged = { ...current, ...update }
	for (const list of PORT_LISTS) {
		const incoming = update[list]
		if (Array.isArray(incoming)) {
			merged[list] = mergePorts(current[list], incoming)
		}
	}
	const mappings = update['port-mappings']
	if (Array.isArray(mappings)) {
		merged['port-mappings'] = mergeMappings(current['port-mappings'], mappings)
	}
	return merged
}

interface UpdatePlan {
	before: TypeSnapshot
	/** Merged definition, for the stub import. */
	item: YamlEntry
	patch: DeviceTypeUpdate
}

async function planUpdate(id: number, text: string): Promise<Result<UpdatePlan, Error>> {
	const before = await snapshotOf(id)
	if (Result.isError(before)) {
		return before
	}
	const definition = parseDefinition(text)
	if (Result.isError(definition)) {
		return definition
	}
	const parsed = v.safeParse(
		DeviceTypeYamlSchema,
		mergeDefinition(before.value.definition, definition.value),
	)
	if (!parsed.success) {
		return Result.err(new ValidationError(formatValibotIssues(parsed.issues)))
	}
	const item = parsed.output
	const db = getDb()
	const manufacturer = (await db.select().from(manufacturers)).find(
		(row) => matchKey(row.name) === matchKey(item.manufacturer),
	)
	if (!manufacturer) {
		return Result.err(new ValidationError(`Unknown manufacturer "${item.manufacturer}"`))
	}
	const roleName = item.default_device_role
	const role = roleName
		? (await db.select().from(device_roles)).find(
				(row) => matchKey(row.name) === matchKey(roleName),
			)
		: undefined
	if (roleName && !role) {
		return Result.err(new ValidationError(`Unknown default_device_role "${roleName}"`))
	}
	return Result.ok({
		before: before.value,
		item,
		// The merge carries every current value, so what is unset here was
		// explicitly set to null and gets cleared.
		patch: {
			manufacturer_id: manufacturer.id,
			model: item.model,
			u_height: item.u_height,
			is_full_depth: item.is_full_depth,
			default_device_role_id: role?.id ?? null,
			part_number: item.part_number || null,
			spec_url: item.spec_url ?? null,
			eol_date: item.eol_date ?? null,
			description: item.description || null,
			comments: item.comments || null,
		},
	})
}

/** Replaces the stubs; fronts go first, as rear stubs can't go while they're mapped. */
async function replaceStubs(id: number, item: YamlEntry): Promise<Result<undefined, Error>> {
	const stubs = await stubsOf(id)
	for (const stub of stubs.toSorted(
		(a, b) => Number(b.side === 'front') - Number(a.side === 'front'),
	)) {
		const deleted = await deleteStub(stub.id)
		if (Result.isError(deleted)) {
			return deleted
		}
	}
	const failure = await createImportedStubs(id, item)
	return failure === null ? Result.ok(undefined) : Result.err(new ValidationError(failure))
}

/** Writes what changed; untouched parts leave no changelog noise. */
async function writeUpdate(
	id: number,
	plan: UpdatePlan,
	parts: { fields: boolean; ports: boolean },
): Promise<Result<undefined, Error>> {
	if (parts.fields) {
		const updated = await updateDeviceType(id, plan.patch)
		if (Result.isError(updated)) {
			return updated
		}
	}
	return parts.ports ? await replaceStubs(id, plan.item) : Result.ok(undefined)
}

/** Thrown inside the update transaction to leave it without its writes. */
class UpdateRollback<T> extends Error {
	constructor(readonly result: Result<T, Error>) {
		super('Device type update rolled back')
	}
}

/** Runs `write` in one transaction, kept only with `commit` and a successful result. */
async function inTransaction<T>(
	commit: boolean,
	write: () => Promise<Result<T, Error>>,
): Promise<Result<T, Error>> {
	try {
		return await withTransaction(async () => {
			const result = await write()
			if (!commit || Result.isError(result)) {
				throw new UpdateRollback(result)
			}
			return result
		})
	} catch (err) {
		if (err instanceof UpdateRollback) {
			return err.result as Result<T, Error>
		}
		return Result.err(errOf(err))
	}
}

function asText(value: unknown): string | null {
	return value === undefined || value === null ? null : String(value)
}

function fieldChanges(before: YamlEntry, after: YamlEntry): DeviceTypeUpdateChange[] {
	return DEVICE_TYPE_UPDATE_FIELDS.flatMap((field) => {
		const from = asText(before[field])
		const to = asText(after[field])
		return from === to ? [] : [{ field, from, to }]
	})
}

const rearLabel = (port: TypePort): string | null =>
	port.rear_name === null ? null : `${port.rear_name} / ${port.rear_port_position ?? 1}`

function portChanges(before: TypePort, after: TypePort): DeviceTypeUpdateChange[] {
	return DEVICE_TYPE_UPDATE_PORT_FIELDS.flatMap((field) => {
		const from = asText(field === 'rear_port' ? rearLabel(before) : before[field])
		const to = asText(field === 'rear_port' ? rearLabel(after) : after[field])
		return from === to ? [] : [{ field, from, to }]
	})
}

const portRef = ({ name, side, kind }: TypePort): DeviceTypeUpdatePort => ({ name, side, kind })

type UpdateDiff = Omit<DeviceTypeUpdatePreview, 'device_count'>

/** The preview of going from `before` to `after`. */
function diffOf(before: TypeSnapshot, after: TypeSnapshot): UpdateDiff {
	const previous = new Map(before.ports.map((port) => [keyOf(port), port]))
	const kept = new Set(after.ports.map(keyOf))
	const changed = after.ports.flatMap((port) => {
		const old = previous.get(keyOf(port))
		const changes = old ? portChanges(old, port) : []
		return changes.length > 0 ? [{ ...portRef(port), changes }] : []
	})
	const added = after.ports.filter((port) => !previous.has(keyOf(port)))
	return {
		revision: before.revision,
		fields: fieldChanges(before.definition, after.definition),
		added_ports: added.map(portRef),
		removed_ports: before.ports.filter((port) => !kept.has(keyOf(port))).map(portRef),
		changed_ports: changed,
		unchanged_ports: after.ports.length - added.length - changed.length,
	}
}

function portsChanged(preview: UpdateDiff): boolean {
	return (
		preview.added_ports.length > 0 ||
		preview.removed_ports.length > 0 ||
		preview.changed_ports.length > 0
	)
}

/** What applying `text` would do; nothing stays written. */
export async function previewDeviceTypeUpdate(
	id: number,
	text: string,
): Promise<Result<DeviceTypeUpdatePreview, Error>> {
	const plan = await planUpdate(id, text)
	if (Result.isError(plan)) {
		return plan
	}
	const diff = await inTransaction<UpdateDiff>(false, async () => {
		const written = await writeUpdate(id, plan.value, { fields: true, ports: true })
		if (Result.isError(written)) {
			return written
		}
		const after = await snapshotOf(id)
		return Result.isError(after) ? after : Result.ok(diffOf(plan.value.before, after.value))
	})
	if (Result.isError(diff)) {
		return diff
	}
	const device_count = await getDb().$count(devices, eq(devices.device_type_id, id))
	return Result.ok({ ...diff.value, device_count })
}

/** Applies a reviewed preview; refuses when the type changed since `revision`. */
export async function applyDeviceTypeUpdate(
	id: number,
	input: DeviceTypeUpdateApply,
): Promise<Result<DeviceTypeRow, Error>> {
	const preview = await previewDeviceTypeUpdate(id, input.yaml)
	if (Result.isError(preview)) {
		return preview
	}
	if (preview.value.revision !== input.revision) {
		return Result.err(
			new ConflictError('The device type changed since this preview; review it again'),
		)
	}
	const plan = await planUpdate(id, input.yaml)
	if (Result.isError(plan)) {
		return plan
	}
	const written = await inTransaction(true, () =>
		writeUpdate(id, plan.value, {
			fields: preview.value.fields.length > 0,
			ports: portsChanged(preview.value),
		}),
	)
	return Result.isError(written) ? written : await getDeviceType(id)
}
