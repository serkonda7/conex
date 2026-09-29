/**
 * Session-wide permissions. The shell sets them from the signed-in
 * user's role; pages and shared components read it to hide add / import /
 * edit / delete actions for viewers (the server answers their writes with
 * 403 either way).
 */
import { createSignal } from 'solid-js'
import type { SessionUser } from './api_auth'

const [role, setRole] = createSignal<SessionUser['role'] | null>(null)

/** Records the signed-in user's role (`null` once signed out). */
export function setSessionRole(next: SessionUser['role'] | null): void {
	setRole(next)
}

/** True for editors and admins; viewers only read. */
export function canWrite(): boolean {
	const current = role()
	return current !== null && current !== 'viewer'
}

const [scoped, setScoped] = createSignal(false)

/** Records whether the user is limited to one tenant (admins never are). */
export function setSessionScoped(next: boolean): void {
	setScoped(next)
}

export function isAdmin(): boolean {
	return role() === 'admin'
}

/** Global editors and admins: may reshape tenants and their links. */
export function canWriteGlobal(): boolean {
	return canWrite() && !scoped()
}
