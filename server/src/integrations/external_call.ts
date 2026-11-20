import { Result } from 'better-result'
import { ensureIntegrationsLive } from '../config'

/** Trims `value`; empty and absent values become `null`. */
export function trimmedText(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? ''
	return trimmed === '' ? null : trimmed
}

/** Runs an external call behind the offline guard, returning errors as a `Result`. */
export async function externalCall<T>(
	system: string,
	run: () => Promise<T>,
	mapError: (error: unknown) => Error,
): Promise<Result<T, Error>> {
	const live = ensureIntegrationsLive(system)
	if (Result.isError(live)) {
		return live
	}
	return Result.tryPromise({ try: run, catch: mapError })
}
