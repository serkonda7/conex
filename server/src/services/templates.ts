import { Result } from 'better-result'
import type { ExpandedInterface } from 'shared/src/schemas'

/**
 * Pure stub-expansion helpers for device templates. They operate on in-memory
 * rows so the `{prefix, count} -> prefix1..prefix{count}` math stays
 * unit-testable without a database; `db/templates.ts` loads the rows and
 * delegates here.
 */

export interface StubInput {
	prefix: string
	count: number
	kind: string
	label?: string | null
	description?: string | null
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
 * same interface name so a template can never deploy overlapping ports.
 */
export function expandStubs(stubs: StubInput[]): Result<ExpandedInterface[], Error> {
	const out: ExpandedInterface[] = []
	const seen = new Set<string>()
	for (const stub of stubs) {
		const names = expandStub(stub.prefix, stub.count)
		if (Result.isError(names)) {
			return Result.err(names.error)
		}
		for (const name of names.value) {
			if (seen.has(name)) {
				return Result.err(new Error(`Stub rows produce duplicate interface name "${name}"`))
			}
			seen.add(name)
			out.push({
				name,
				kind: stub.kind,
				label: stub.label ?? null,
				description: stub.description ?? null,
			})
		}
	}
	return Result.ok(out)
}
