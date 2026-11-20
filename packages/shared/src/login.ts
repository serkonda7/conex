/**
 * Account login: the employee's primary mail address, stored trimmed and
 * lower-cased. Shared by account provisioning and the client so the same
 * identity is computed on both sides.
 */
export function normalizeLogin(raw: string): string {
	return raw.trim().toLowerCase()
}
