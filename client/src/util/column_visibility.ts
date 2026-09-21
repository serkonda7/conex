import { createSignal } from 'solid-js'

const STORAGE_PREFIX = 'conex:columns:'

/** Reads persisted visible-column keys for a table, or null when unset/corrupt. */
export function load_visible_columns(key: string): string[] | null {
	try {
		const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`)
		if (!raw) {
			return null
		}
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
			return null
		}
		return parsed as string[]
	} catch {
		return null
	}
}

function save_visible_columns(key: string, visible: string[]): void {
	try {
		window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(visible))
	} catch {
		// Storage full or unavailable (private mode): customization still
		// works for the session, it just does not persist.
	}
}

/**
 * Controlled `visibleColumns` state for a DataTable column customizer,
 * persisted to localStorage under `conex:columns:<key>`. Unknown stored
 * keys (from an older column set) are dropped; when nothing valid is
 * stored, every column starts visible.
 */
export function use_visible_columns(
	key: string,
	all_keys: string[],
): [() => string[], (visible: string[]) => void] {
	const stored = load_visible_columns(key)?.filter((k) => all_keys.includes(k))
	const [visible, setVisible] = createSignal<string[]>(stored ?? [...all_keys])

	function handle_change(next: string[]): void {
		// Keep the DataTable's canonical column order; the customizer may
		// hand back keys in toggle order.
		const ordered = all_keys.filter((k) => next.includes(k))
		setVisible(ordered)
		save_visible_columns(key, ordered)
	}

	return [visible, handle_change]
}
