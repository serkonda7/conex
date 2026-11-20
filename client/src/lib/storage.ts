/**
 * localStorage access that never throws. Storage may be disabled (private
 * mode) or full: reads then return null and writes are ignored, so a
 * preference still applies in memory even when it cannot be persisted.
 */

/** Stored string, or null when unset, unreadable or storage is unavailable. */
export function readStored(key: string): string | null {
	try {
		return window.localStorage.getItem(key)
	} catch {
		return null
	}
}

/** Stores `value`; full or unavailable storage is ignored. */
export function writeStored(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value)
	} catch {
		// Storage full or unavailable: the value still applies for this session.
	}
}

/** Removes `key`; full or unavailable storage is ignored. */
export function removeStored(key: string): void {
	try {
		window.localStorage.removeItem(key)
	} catch {
		// Storage unavailable: the change still applies for this session.
	}
}

/** Stored JSON value, or `fallback` when unset, corrupt or storage is unavailable. */
export function readStoredJson<T>(key: string, fallback: T): T {
	const raw = readStored(key)
	if (raw === null) {
		return fallback
	}
	try {
		return JSON.parse(raw) as T
	} catch {
		return fallback
	}
}

/** Stores `value` as JSON; full, unavailable or non-serializable data is ignored. */
export function writeStoredJson(key: string, value: unknown): void {
	try {
		writeStored(key, JSON.stringify(value))
	} catch {
		// Not serializable: nothing to persist.
	}
}
