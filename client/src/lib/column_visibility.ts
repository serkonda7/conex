import { createSignal } from 'solid-js'
import { readStored, readStoredJson, writeStoredJson } from './storage'

const STORAGE_PREFIX = 'conex:columns:'

/** Reads persisted visible-column keys for a table, or null when unset/corrupt. */
function load_visible_columns(key: string): string[] | null {
	const storage_key = `${STORAGE_PREFIX}${key}`
	if (!readStored(storage_key)) {
		return null
	}
	const parsed = readStoredJson<unknown>(storage_key, null)
	if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
		return null
	}
	return parsed as string[]
}

function save_visible_columns(key: string, visible: string[]): void {
	writeStoredJson(`${STORAGE_PREFIX}${key}`, visible)
}

/**
 * Controlled `visibleColumns` state for a DataTable column customizer,
 * persisted to localStorage under `conex:columns:<key>`. Unknown stored
 * keys (from an older column set) are dropped; when nothing valid is
 * stored, every column starts visible unless default_keys is provided.
 */
export function use_visible_columns(
	key: string,
	all_keys: string[],
	default_keys: string[] = all_keys,
): [() => string[], (visible: string[]) => void] {
	const stored = load_visible_columns(key)?.filter((k) => all_keys.includes(k))
	const defaults = all_keys.filter((k) => default_keys.includes(k))
	const [visible, setVisible] = createSignal<string[]>(stored ?? defaults)

	function handle_change(next: string[]): void {
		// Keep the DataTable's canonical column order; the customizer may
		// hand back keys in toggle order.
		const ordered = all_keys.filter((k) => next.includes(k))
		setVisible(ordered)
		save_visible_columns(key, ordered)
	}

	return [visible, handle_change]
}
