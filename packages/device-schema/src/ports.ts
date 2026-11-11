import * as v from 'valibot'
import {
	DISPLAY_PORT_KINDS,
	GENERAL_PORT_KINDS,
	NETBOX_INTERFACE_TYPES,
	PASS_THROUGH_PORT_TYPES,
	POWER_INPUT_KINDS,
	POWER_OUTLET_KINDS,
} from './constants'
import {
	DeviceTypeYamlSchema,
	formatValibotIssues,
	type ImportedStub,
	ImportedStubSchema,
	StubPowerEntries,
} from './schema'
import {
	type Checked,
	collapseRuns,
	expandNameTemplate,
	expandStubs,
	type StubInput,
	type StubRun,
	stubPowerError,
} from './stubs'

const POWER_CONNECTOR_KINDS = new Set<string>([...POWER_INPUT_KINDS, ...POWER_OUTLET_KINDS])

/** NetBox `maximum_draw` of a power port and `poe_mode`/`poe_type` of an interface. */
const ImportedPowerSchema = v.object(StubPowerEntries)

/** One stub to create, in plan order: rear ports, front ports, then the component lists. */
export interface PlannedStub extends ImportedStub {
	/** YAML list the stub came from, to name it in messages. */
	list: string
	/** Front ports: index in the plan of the rear port they map onto. */
	rear_index?: number
}

type Mapping = Record<string, unknown>

/** Mappings of one YAML component list; any other entry is an error. */
function componentsOf(key: string, list: unknown): Checked<Mapping[]> {
	if (list === undefined) {
		return { ok: true, value: [] }
	}
	if (!Array.isArray(list)) {
		return { ok: false, error: `${key} must be a list` }
	}
	const mappings: Mapping[] = []
	for (const entry of list) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			return { ok: false, error: `${key}: entries must be mappings` }
		}
		mappings.push(entry as Mapping)
	}
	return { ok: true, value: mappings }
}

/** Trimmed `name` of a YAML port entry, or an empty string when missing. */
function nameOf(port: Mapping): string {
	return typeof port.name === 'string' ? port.name.trim() : ''
}

/** NetBox port type (`8p8c`, `lc`, `mpo`, …) as the stored kind; null when not a known pass-through type. */
function passThroughKindOf(port: Mapping): string | null {
	const type = typeof port.type === 'string' ? port.type.trim() : ''
	return Object.keys(PASS_THROUGH_PORT_TYPES).includes(type) ? type : null
}

/** The plan so far; each stub must fit the ones before it, as on the stub API. */
class Plan {
	readonly stubs: PlannedStub[] = []
	readonly #inputs: StubInput[] = []

	/** Answers the plan index of the added stub, or the failure message. */
	add(list: string, input: Omit<PlannedStub, 'list'>): Checked<number> {
		const { rear_index, ...fields } = input
		const label = `${list} "${input.prefix}"`
		const parsed = v.safeParse(ImportedStubSchema, fields)
		if (!parsed.success) {
			return { ok: false, error: `${label}: ${formatValibotIssues(parsed.issues)}` }
		}
		const index = this.stubs.length
		const stub: StubInput = { ...parsed.output, id: index, rear_stub_id: rear_index ?? null }
		const failure = stubPowerError(stub)
		if (failure !== null) {
			return { ok: false, error: `${label}: ${failure}` }
		}
		this.#inputs.push(stub)
		const expanded = expandStubs(this.#inputs)
		if (!expanded.ok) {
			return { ok: false, error: `${label}: ${expanded.error}` }
		}
		this.stubs.push({ ...parsed.output, list, rear_index })
		return { ok: true, value: index }
	}
}

/** A rear port of the plan: its stub, its index in that stub and its slot count. */
interface PlannedRear {
	stub: number
	offset: number
	positions: number
}

/** Splits items, in order, into segments of neighbours that belong together. */
function segmentsOf<T>(items: T[], sameSegment: (prev: T, next: T) => boolean): T[][] {
	const segments: T[][] = []
	for (const item of items) {
		const last = segments.at(-1)
		const prev = last?.at(-1)
		if (last && prev !== undefined && sameSegment(prev, item)) {
			last.push(item)
		} else {
			segments.push([item])
		}
	}
	return segments
}

/**
 * NetBox `rear-ports` (`{name, type, positions}`) and `front-ports`
 * (`{name, type, rear_port, rear_port_position}`): numbered series collapse
 * into runs as on the other lists (`Rear 01..Rear 24`). Single-position rear
 * ports of one type form a run; multi-position ones (MPO) stay single-port
 * stubs. A front run maps consecutive front ports of one type onto
 * consecutive slots of one rear run. The mapping comes inline, or via NetBox
 * 4.3+ `port-mappings`, onto the rear port of that name in the same document.
 * Rear ports come first so the front ports can reference them. Answers the
 * failure message, or null.
 */
function planPassThroughPorts(plan: Plan, item: Mapping): string | null {
	const rearByName = new Map<string, PlannedRear>()
	const rears = componentsOf('rear-ports', item['rear-ports'])
	if (!rears.ok) {
		return rears.error
	}
	const rearPorts: { name: string; kind: string; positions: number }[] = []
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
		if (!names.ok) {
			return `rear-ports "${name}": ${names.error}`
		}
		rearPorts.push(...names.value.map((prefix) => ({ name: prefix, kind, positions })))
	}
	const rearSegments = segmentsOf(
		rearPorts,
		(prev, next) => prev.positions === 1 && next.positions === 1 && prev.kind === next.kind,
	)
	for (const segment of rearSegments) {
		const first = segment[0]
		if (!first) {
			continue
		}
		let offset = 0
		for (const run of collapseRuns(segment.map((port) => port.name))) {
			const stub = plan.add('rear-ports', {
				...runFields(run),
				kind: first.kind,
				side: 'rear',
				positions: first.positions,
			})
			if (!stub.ok) {
				return stub.error
			}
			for (let i = 0; i < run.count; i += 1) {
				const port = segment[offset + i]
				if (port) {
					rearByName.set(port.name, {
						stub: stub.value,
						offset: i,
						positions: port.positions,
					})
				}
			}
			offset += run.count
		}
	}
	// NetBox 4.3+ moves the mapping out of the front port into a top-level
	// `port-mappings` list (`{front_port, front_port_position, rear_port,
	// rear_port_position}`); the first mapping of a front port wins.
	const mappingByFront = new Map<string, Mapping>()
	const mappings = componentsOf('port-mappings', item['port-mappings'])
	if (!mappings.ok) {
		return mappings.error
	}
	for (const mapping of mappings.value) {
		const front = typeof mapping.front_port === 'string' ? mapping.front_port.trim() : ''
		if (front && !mappingByFront.has(front)) {
			mappingByFront.set(front, mapping)
		}
	}
	const fronts = componentsOf('front-ports', item['front-ports'])
	if (!fronts.ok) {
		return fronts.error
	}
	const frontPorts: { name: string; kind: string; rear: number; slot: number }[] = []
	for (const port of fronts.value) {
		const name = nameOf(port)
		if (!name) {
			return 'front-ports: entry without a name'
		}
		const names = expandNameTemplate(name)
		if (!names.ok) {
			return `front-ports "${name}": ${names.error}`
		}
		// A front port takes one rear slot, so a name template cannot expand.
		if (names.value.length !== 1) {
			return `front-ports "${name}": name templates are not supported on front ports`
		}
		const source = port.rear_port === undefined ? (mappingByFront.get(name) ?? port) : port
		const rearName = typeof source.rear_port === 'string' ? source.rear_port.trim() : ''
		const rear = rearByName.get(rearName)
		if (rear === undefined) {
			return `front-ports "${name}": unknown rear_port "${rearName}"`
		}
		const position =
			source.rear_port_position === undefined ? 1 : Number(source.rear_port_position)
		if (!Number.isInteger(position) || position < 1) {
			return `front-ports "${name}": rear_port_position must be an integer of at least 1`
		}
		if (position > rear.positions) {
			return `front-ports "${name}": rear_port_position exceeds the ${rear.positions} position(s) of rear port "${rearName}"`
		}
		const kind = passThroughKindOf(port)
		if (kind === null) {
			return `front-ports "${name}": type must be one of ${Object.keys(PASS_THROUGH_PORT_TYPES).join(', ')}`
		}
		frontPorts.push({
			name: names.value[0] ?? name,
			kind,
			rear: rear.stub,
			slot: rear.offset * rear.positions + position - 1,
		})
	}
	const frontSegments = segmentsOf(
		frontPorts,
		(prev, next) =>
			prev.kind === next.kind && prev.rear === next.rear && next.slot === prev.slot + 1,
	)
	for (const segment of frontSegments) {
		let offset = 0
		for (const run of collapseRuns(segment.map((port) => port.name))) {
			const first = segment[offset]
			if (!first) {
				break
			}
			const stub = plan.add('front-ports', {
				...runFields(run),
				kind: first.kind,
				side: 'front',
				rear_index: first.rear,
				rear_position: first.slot + 1,
			})
			if (!stub.ok) {
				return stub.error
			}
			offset += run.count
		}
	}
	return null
}

/** The stub fields of a collapsed run; defaults stay unset. */
function runFields(run: StubRun): Pick<PlannedStub, 'prefix' | 'count' | 'digits' | 'start'> {
	return {
		prefix: run.prefix,
		count: run.count,
		...(run.digits > 1 ? { digits: run.digits } : {}),
		...(run.start === 1 ? {} : { start: run.start }),
	}
}

/** The component lists of a definition, grouped into runs of equal ports. */
function planComponents(plan: Plan, item: Mapping): string | null {
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
			power: v.InferOutput<typeof ImportedPowerSchema>
			names: string[]
		}
	>()
	for (const [key, defaultKind, allowed] of componentLists) {
		const components = componentsOf(key, item[key])
		if (!components.ok) {
			return components.error
		}
		for (const port of components.value) {
			const name = nameOf(port)
			if (!name) {
				return `${key}: entry without a name`
			}
			// NetBox interface types may be a list; the first entry wins.
			// Ports keep a known connector type (usb-c, rj-45, …) as kind;
			// `other` is stored as the plain `port`. Any other type is an error.
			// Power ports and outlets keep a known connector type, prefixed
			// with their class (`power-iec-60320-c14`); any other type falls
			// back to the plain class, so NEMA & co. still import.
			// Display ports (not a NetBox class) keep their connector type as
			// kind.
			const type = Array.isArray(port.type) ? port.type[0] : port.type
			let kind: string | null = defaultKind
			if (allowed !== null && type !== undefined && type !== null) {
				if (typeof type !== 'string' || !allowed.includes(type)) {
					return `${key} "${name}": type must be one of ${allowed.join(', ')}`
				}
				kind = type === 'other' && key !== 'interfaces' ? 'port' : type
			}
			if (allowed === null && POWER_CONNECTOR_KINDS.has(`${defaultKind}-${type}`)) {
				kind = `${defaultKind}-${type}`
			}
			if (kind === null) {
				return `${key} "${name}": type is required`
			}
			const names = expandNameTemplate(name)
			if (!names.ok) {
				return `${key} "${name}": ${names.error}`
			}
			const power = v.safeParse(ImportedPowerSchema, {
				maximum_draw: key === 'power-ports' ? port.maximum_draw : undefined,
				poe_mode: key === 'interfaces' ? port.poe_mode : undefined,
				// Passive PoE has no type here; such a port keeps just its mode.
				poe_type:
					key === 'interfaces' && !String(port.poe_type).startsWith('passive-')
						? port.poe_type
						: undefined,
			})
			if (!power.success) {
				return `${key} "${name}": ${formatValibotIssues(power.issues)}`
			}
			// A stub carries one kind and power setup, so both must match to collapse ports.
			const groupKey = JSON.stringify([key, kind, power.output])
			const group = groups.get(groupKey) ?? {
				key,
				kind,
				power: power.output,
				names: [],
			}
			group.names.push(...names.value)
			groups.set(groupKey, group)
		}
	}
	for (const group of groups.values()) {
		for (const run of collapseRuns(group.names)) {
			const stub = plan.add(group.key, {
				...runFields(run),
				kind: group.kind,
				...group.power,
			})
			if (!stub.ok) {
				return stub.error
			}
		}
	}
	return null
}

/**
 * The stubs a parsed YAML definition turns into, or why it can't be imported:
 * every port rule that needs no other data than the definition.
 */
export function planDeviceTypePorts(item: Record<string, unknown>): Checked<PlannedStub[]> {
	const plan = new Plan()
	const failure = planPassThroughPorts(plan, item) ?? planComponents(plan, item)
	return failure === null ? { ok: true, value: plan.stubs } : { ok: false, error: failure }
}

/**
 * Why conex would refuse a definition, or null. Whether its manufacturer and
 * role exist, and whether the model is taken, depends on the conex instance.
 */
export function validateDeviceType(definition: unknown): string | null {
	const parsed = v.safeParse(DeviceTypeYamlSchema, definition)
	if (!parsed.success) {
		return formatValibotIssues(parsed.issues)
	}
	const ports = planDeviceTypePorts(parsed.output)
	return ports.ok ? null : ports.error
}
