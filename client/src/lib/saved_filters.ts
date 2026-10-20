import { Result } from 'better-result'
import { type Accessor, createSignal, onMount } from 'solid-js'
import { fetch_saved_filters, put_saved_filters, type SavedFilterJson } from '../api/saved_filters'

/**
 * Controlled `savedFilters` state for a FilterTable, persisted globally (for
 * all users) under the table key `table`. Changes show at once; saves run
 * in order, and a failed one restores the last stored list and reports
 * through `error`.
 */
export function use_saved_filters(table: string): {
	savedFilters: Accessor<SavedFilterJson[]>
	onSavedFiltersChange: (next: SavedFilterJson[]) => void
	error: Accessor<string | null>
} {
	const [savedFilters, setSavedFilters] = createSignal<SavedFilterJson[]>([])
	const [error, setError] = createSignal<string | null>(null)
	let stored: SavedFilterJson[] = []
	let pending: Promise<void> = Promise.resolve()

	onMount(() => {
		pending = fetch_saved_filters(table).then((res) => {
			if (Result.isError(res)) {
				setError(res.error.message)
				return
			}
			stored = res.value
			setSavedFilters(stored)
		})
	})

	function onSavedFiltersChange(next: SavedFilterJson[]): void {
		setSavedFilters(next)
		pending = pending.then(async () => {
			const res = await put_saved_filters(table, next)
			if (Result.isError(res)) {
				setError(res.error.message)
				setSavedFilters(stored)
				return
			}
			setError(null)
			stored = res.value
		})
	}

	return { savedFilters, onSavedFiltersChange, error }
}
