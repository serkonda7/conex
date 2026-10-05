/**
 * Shared Postgres error predicates. Drizzle wraps driver errors in a
 * `DrizzleQueryError` whose `cause` is the Bun `PostgresError`.
 */

const PG_UNIQUE_VIOLATION = '23505'

export function isUniqueViolation(err: unknown): boolean {
	let current: unknown = err
	for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
		const { errno, code } = current as Error & { errno?: unknown; code?: unknown }
		if (errno === PG_UNIQUE_VIOLATION || code === PG_UNIQUE_VIOLATION) {
			return true
		}
		if (current.message.includes('duplicate key value violates unique constraint')) {
			return true
		}
		current = current.cause
	}
	return false
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

/**
 * Wrapped in a `Result.err` when input is well-formed but rejected, e.g.
 * integration credentials the external system refused. Mapped to 422.
 */
export class ValidationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ValidationError'
	}
}

/** Wrapped in a `Result.err` when an external system fails. Mapped to 502. */
export class ExternalServiceError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ExternalServiceError'
	}
}
