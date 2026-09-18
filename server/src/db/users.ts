import { and, eq, gt } from 'drizzle-orm'
import { auth_states, users } from '../schema'
import type { User } from '../types'
import { normalize_email } from '../util/email'
import { getDb } from './connection'

export function getUserByEmail(email: string): User | null {
	const normalized = normalize_email(email)
	const row = getDb().select().from(users).where(eq(users.email, normalized)).get()
	return (row as User | null) ?? null
}

export function createLocalUser(email: string, passwordHash: string): User {
	const normalizedEmail = normalize_email(email)
	const user: User = {
		id: Bun.randomUUIDv7(),
		email: normalizedEmail,
		password_hash: passwordHash,
		provider: 'local',
		provider_id: null,
	}
	getDb().insert(users).values(user).run()
	return user
}

/** True when at least one user exists. Drives first-run setup gating. */
export function hasAnyUser(): boolean {
	const row = getDb().select({ id: users.id }).from(users).limit(1).get()
	return row !== undefined && row !== null
}

// ---------------------------------------------------------------------------
// OAuth-style login states (kept for the session sweep; consumed by future
// external providers, if any).
// ---------------------------------------------------------------------------

export function createAuthState(state: string, verifier: string, expiresAt: number): void {
	getDb().insert(auth_states).values({ state, verifier, expires_at: expiresAt }).run()
}

export interface ConsumedAuthState {
	verifier: string
}

/**
 * Atomically consumes a state: deletes the row only when it exists
 * and has not expired, returning its verifier.
 *
 * Returns `null` when the state is missing or expired. Expired rows are
 * removed as a side effect so failed callbacks do not accumulate.
 */
export function consumeAuthState(state: string, now: number): ConsumedAuthState | null {
	const consumed = getDb()
		.delete(auth_states)
		.where(and(eq(auth_states.state, state), gt(auth_states.expires_at, now)))
		.returning({ verifier: auth_states.verifier })
		.get()
	if (consumed) {
		return consumed
	}
	// Missing or expired: drop an expired leftover if present, then report miss.
	getDb().delete(auth_states).where(eq(auth_states.state, state)).run()
	return null
}
