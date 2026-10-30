import { Result } from 'better-result'
import type { ExpandedInterface, PortSide } from 'shared/src/schemas'

/**
 * Pure stub-expansion helpers for device templates. They operate on in-memory
 * rows so the `{prefix, count} -> prefix1..prefix{count}` math stays
 * unit-testable without a database; `db/templates.ts` loads the rows and
 * delegates here.
 */

export interface StubInput {
	/** Row id; front stubs reference their rear stub by it. */
	id?: number
	prefix: string
	count: number
	kind: string
	description?: string | null
	side?: PortSide | null
	positions?: number
	rear_stub_id?: number | null
	rear_position?: number
}

function invalid(message: string): Result<never, Error> {
	return Result.err(new Error(message))
}

/**
 * Expands one stub row into concrete interface names:
 * `{prefix: "eth", count: 24}` -> `eth1..eth24`.
 * A single-port stub keeps its name verbatim (`Port 1` stays `Port 1`);
 * only multi-port stubs append a 1-based index.
 */
export function expandStub(prefix: string, count: number): Result<string[], Error> {
	const trimmed = prefix.trim()
	if (trimmed.length === 0) {
		return invalid('Stub prefix must not be empty')
	}
	if (!Number.isInteger(count) || count < 1) {
		return invalid('Stub count must be an integer of at least 1')
	}
	if (count === 1) {
		return Result.ok([trimmed])
	}
	const names: string[] = []
	for (let i = 1; i <= count; i += 1) {
		names.push(`${trimmed}${i}`)
	}
	return Result.ok(names)
}

/** Upper bound on the names one NetBox name template may expand to. */
const MAX_TEMPLATE_NAMES = 1000

function templateChoices(body: string): Result<string[], Error> {
	const choices: string[] = []
	for (const part of body.split(',')) {
		const item = part.trim()
		const numeric = /^(\d+)-(\d+)$/.exec(item)
		const alpha = /^([A-Za-z])-([A-Za-z])$/.exec(item)
		if (numeric) {
			const [, from = '', to = ''] = numeric
			const start = Number(from)
			const end = Number(to)
			if (start > end) {
				return invalid(`Name template range "${item}" runs backwards`)
			}
			for (let i = start; i <= end; i += 1) {
				choices.push(String(i).padStart(from.length, '0'))
			}
		} else if (alpha) {
			const [, from = '', to = ''] = alpha
			if (from > to) {
				return invalid(`Name template range "${item}" runs backwards`)
			}
			for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c += 1) {
				choices.push(String.fromCharCode(c))
			}
		} else if (item.length > 0 && !/[[\]]/.test(item)) {
			choices.push(item)
		} else {
			return invalid(`Name template "[${body}]" has an empty or invalid entry`)
		}
		if (choices.length > MAX_TEMPLATE_NAMES) {
			return invalid(`Name template expands to more than ${MAX_TEMPLATE_NAMES} names`)
		}
	}
	return Result.ok(choices)
}

/**
 * Expands a NetBox name template into concrete port names:
 * `Gi1/0/[1-3]` -> `Gi1/0/1`, `Gi1/0/2`, `Gi1/0/3`; `[a-b]` and `[x,y]`
 * work the same way, and several bracket groups combine. A name without
 * brackets is returned unchanged.
 */
export function expandNameTemplate(name: string): Result<string[], Error> {
	const parts = name.split(/(\[[^[\]]*\])/)
	let names = ['']
	for (const part of parts) {
		if (part.startsWith('[') && part.endsWith(']') && part.length > 2) {
			const choices = templateChoices(part.slice(1, -1))
			if (Result.isError(choices)) {
				return choices
			}
			if (names.length * choices.value.length > MAX_TEMPLATE_NAMES) {
				return invalid(`Name template expands to more than ${MAX_TEMPLATE_NAMES} names`)
			}
			names = names.flatMap((prefix) => choices.value.map((choice) => `${prefix}${choice}`))
		} else if (/[[\]]/.test(part)) {
			return invalid(`Name template "${name}" has unbalanced brackets`)
		} else {
			names = names.map((prefix) => `${prefix}${part}`)
		}
	}
	return Result.ok(names)
}

/** One stub row that `expandStub` turns back into `count` names. */
export interface StubRun {
	prefix: string
	count: number
}

/**
 * Collapses consecutive names `B1, B2, …, Bn` into one `{prefix: B, count: n}`
 * stub. Only runs that `expandStub` reproduces exactly collapse; a run that
 * starts above 1 (`Gi1/0/25…`) stays one stub per name.
 */
export function collapseRuns(names: string[]): StubRun[] {
	const runs: StubRun[] = []
	let i = 0
	while (i < names.length) {
		const first = names[i] ?? ''
		const base = first.endsWith('1') ? first.slice(0, -1) : ''
		let count = 0
		if (base.length > 0 && base === base.trim()) {
			while (names[i + count] === `${base}${count + 1}`) {
				count += 1
			}
		}
		if (count >= 2) {
			runs.push({ prefix: base, count })
			i += count
		} else {
			runs.push({ prefix: first, count: 1 })
			i += 1
		}
	}
	return runs
}

/**
 * Expands every stub row of a device type. Errs when two stubs produce the
 * same interface name on the same side, so a template can never deploy
 * overlapping ports.
 *
 * Pass-through mapping: a rear stub with count R and P positions gives R×P
 * slots (rear 1 positions 1..P, then rear 2, …). Front port i (from 0) of
 * a front stub takes slot `(rear_position - 1) + i`, i.e. rear port
 * `slot ÷ P`, position `slot mod P + 1`. A front stub that does not fit
 * its rear stub, or two front stubs sharing a slot, are rejected.
 */
export function expandStubs(stubs: StubInput[]): Result<ExpandedInterface[], Error> {
	const out: ExpandedInterface[] = []
	const seen = new Set<string>()
	/** Rear stub id -> index of its first expanded rear port in `out`. */
	const rearStart = new Map<number, number>()
	const add = (stub: StubInput, names: string[]): number => {
		const start = out.length
		for (const name of names) {
			out.push({
				name,
				kind: stub.kind,
				description: stub.description ?? null,
				side: stub.side ?? null,
				positions: stub.side === 'rear' ? (stub.positions ?? 1) : 1,
				rear_index: null,
				rear_port_position: null,
			})
		}
		return start
	}
	const expanded: [StubInput, string[]][] = []
	for (const stub of stubs) {
		const names = expandStub(stub.prefix, stub.count)
		if (Result.isError(names)) {
			return Result.err(names.error)
		}
		for (const name of names.value) {
			const key = `${stub.side ?? ''}:${name}`
			if (seen.has(key)) {
				return Result.err(new Error(`Stub rows produce duplicate interface name "${name}"`))
			}
			seen.add(key)
		}
		expanded.push([stub, names.value])
	}
	// Rear ports first, so front ports can point at them.
	for (const [stub, names] of expanded) {
		if (stub.side !== 'front') {
			const start = add(stub, names)
			if (stub.side === 'rear' && stub.id !== undefined) {
				rearStart.set(stub.id, start)
			}
		}
	}
	const taken = new Set<string>()
	for (const [stub, names] of expanded) {
		if (stub.side !== 'front') {
			continue
		}
		const rear = stubs.find((s) => s.side === 'rear' && s.id === stub.rear_stub_id)
		const firstRear = stub.rear_stub_id == null ? undefined : rearStart.get(stub.rear_stub_id)
		if (!rear || firstRear === undefined) {
			return invalid(`Front port stub "${stub.prefix}" needs a rear port stub of this type`)
		}
		const positions = rear.positions ?? 1
		const firstSlot = (stub.rear_position ?? 1) - 1
		if (firstSlot + names.length > rear.count * positions) {
			return invalid(
				`Front port stub "${stub.prefix}" does not fit rear port stub "${rear.prefix}"`,
			)
		}
		const start = add(stub, names)
		for (let i = 0; i < names.length; i += 1) {
			const slot = firstSlot + i
			const key = `${rear.id}:${slot}`
			if (taken.has(key)) {
				return invalid(
					`Front port stubs overlap on rear port stub "${rear.prefix}" (slot ${slot + 1})`,
				)
			}
			taken.add(key)
			const port = out[start + i]
			if (port) {
				port.rear_index = firstRear + Math.floor(slot / positions)
				port.rear_port_position = (slot % positions) + 1
			}
		}
	}
	return Result.ok(out)
}
