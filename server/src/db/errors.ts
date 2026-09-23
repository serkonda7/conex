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

/** Wrapped in a `Result.err` when a unique row collides under concurrency. */
export class DuplicateError extends Error {
	constructor(message = 'A record with these values already exists') {
		super(message)
		this.name = 'DuplicateError'
	}
}

/** Wrapped in a `Result.err` when a row is missing. Mapped to 404. */
export class NotFoundError extends Error {
	constructor(message = 'Not found') {
		super(message)
		this.name = 'NotFoundError'
	}
}

/**
 * Wrapped in a `Result.err` when a delete (or move) is refused because
 * dependent rows exist. Mapped to 409.
 */
export class ConflictError extends Error {
	constructor(message = 'Operation conflicts with existing data') {
		super(message)
		this.name = 'ConflictError'
	}
}

/** Wrapped in a `Result.err` when RBAC refuses an operation. Mapped to 403. */
export class ForbiddenError extends Error {
	constructor(message = 'Forbidden') {
		super(message)
		this.name = 'ForbiddenError'
	}
}
