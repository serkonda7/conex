/** Shared SQLite error predicates. Drizzle rethrows the raw Bun SQLiteError. */

export function isUniqueViolation(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false
	}
	const code = (err as Error & { code?: unknown }).code
	if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
		return true
	}
	return err.message.includes('UNIQUE constraint failed')
}

export function isForeignKeyViolation(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false
	}
	const code = (err as Error & { code?: unknown }).code
	if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
		return true
	}
	return err.message.includes('FOREIGN KEY constraint failed')
}

/** Wrapped in a `Result.err` when a unique row collides under concurrency. */
export class DuplicateError extends Error {
	constructor(message = 'A record with these values already exists') {
		super(message)
		this.name = 'DuplicateError'
	}
}
