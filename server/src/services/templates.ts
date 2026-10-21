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
	label?: string | null
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
				label: stub.label ?? null,
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
