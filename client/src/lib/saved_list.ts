import { Result } from 'better-result'
import { type Accessor, createSignal, onMount } from 'solid-js'

/**
 * A server-stored list (saved filters or layouts of one table) for a
 * controlled table prop. Changes show at once; saves run in order, and a
 * failed one restores the last stored list and reports through `error`.
 */
export function use_saved_list<T>(api: {
	fetch: () => Promise<Result<T[], Error>>
	put: (next: T[]) => Promise<Result<T[], Error>>
}): {
	items: Accessor<T[]>
	onChange: (next: T[]) => void
	error: Accessor<string | null>
} {
	const [items, setItems] = createSignal<T[]>([])
	const [error, setError] = createSignal<string | null>(null)
	let stored: T[] = []
	let pending: Promise<void> = Promise.resolve()

	onMount(() => {
		pending = api.fetch().then((res) => {
			if (Result.isError(res)) {
				setError(res.error.message)
				return
			}
			stored = res.value
			setItems(() => stored)
		})
	})

	function onChange(next: T[]): void {
		setItems(() => next)
		pending = pending.then(async () => {
			const res = await api.put(next)
			if (Result.isError(res)) {
				setError(res.error.message)
				setItems(() => stored)
				return
			}
			setError(null)
			stored = res.value
		})
	}

	return { items, onChange, error }
}
