import {
	type Checked,
	type ExpandedInterface,
	expandNameTemplate as expandPackageNameTemplate,
	expandStub as expandPackageStub,
	expandStubs as expandPackageStubs,
	type StubInput,
} from '@serkonda7/conex-device-schema'
import { Result } from 'better-result'

export type { StubInput, StubRun } from '@serkonda7/conex-device-schema'
export { collapseRuns, stubPowerError, stubPrefix } from '@serkonda7/conex-device-schema'

/**
 * The package's pure stub helpers as `Result`s for service code; the math and
 * its docs live in `@serkonda7/conex-device-schema`, as imports share it.
 */

function toResult<T>(checked: Checked<T>): Result<T, Error> {
	return checked.ok ? Result.ok(checked.value) : Result.err(new Error(checked.error))
}

export function expandStub(
	stub: Pick<StubInput, 'prefix' | 'count' | 'digits' | 'start'>,
): Result<string[], Error> {
	return toResult(expandPackageStub(stub.prefix, stub.count, stub.digits, stub.start))
}

export function expandNameTemplate(name: string): Result<string[], Error> {
	return toResult(expandPackageNameTemplate(name))
}

export function expandStubs(stubs: StubInput[]): Result<ExpandedInterface[], Error> {
	return toResult(expandPackageStubs(stubs))
}
