/**
 * Query-cache wrappers for the API's `Result` returns. A failed request
 * reports to the page's error line and falls back to an empty value, so the
 * rest of the page stays usable. Queries are keyed by the load function plus
 * the source value: pages passing the same named fetcher share one cache
 * entry, inline closures get their own. `useAction` is the write-side
 * counterpart.
 */
import {
	hashKey,
	keepPreviousData,
	QueryObserver,
	type QueryObserverResult,
} from '@tanstack/solid-query'
import { Result } from 'better-result'
import {
	type Accessor,
	createComputed,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	on,
	onCleanup,
	type ResourceReturn,
	untrack,
} from 'solid-js'
import { is_current, mark_fetch, queryClient, writeSettled } from './query'
import { usePaneVisible } from './router'

/** Receives the message of a failed request (usually a page's `setError`). */
export type ErrorSink = (message: string) => void

/** The value of `res`, or `fallback` after reporting the error to `onError`. */
export function unwrap<T, F>(res: Result<T, Error>, fallback: F, onError?: ErrorSink): T | F {
	if (Result.isError(res)) {
		onError?.(res.error.message)
		return fallback
	}
	return res.value
}

/** Cached data as an accessor; `undefined` until the first answer. */
export interface QueryResource<T> {
	(): T | undefined
	/** True while there is nothing to show yet; background refreshes keep the data. */
	readonly loading: boolean
}

export type QueryReturn<T> = [
	QueryResource<T>,
	{
		refetch: () => Promise<void>
		/** Replaces the cached value (e.g. with the saved record a write returned). */
		mutate: (value: T) => void
	},
]

/** Unique numbers for load functions: `fn.name` does not survive minification. */
const loaderIds = new WeakMap<object, number>()
let nextLoaderId = 1

function loaderId(load: object): number {
	const known = loaderIds.get(load)
	if (known !== undefined) {
		return known
	}
	const id = nextLoaderId++
	loaderIds.set(load, id)
	return id
}

type Key<S> = [number] | [number, S]

/** Observes the query of `source`; nothing loads while `key` is null. */
function observe<S, D, T>(opts: {
	key: Accessor<Key<S> | null>
	idle: Key<S>
	load: (value: S) => Promise<D>
	view: (data: D) => T
	fallback?: T
	onError?: ErrorSink
	keepPrevious?: boolean
}): [QueryResource<T>, QueryReturn<D>[1]] {
	const options = (
		key: Key<S> | null,
	): {
		queryKey: Key<S>
		queryFn: (context: { queryKey: Key<S> }) => Promise<D>
		enabled: boolean
		placeholderData: typeof keepPreviousData | undefined
	} => ({
		queryKey: key ?? opts.idle,
		queryFn: (context: { queryKey: Key<S> }): Promise<D> => {
			mark_fetch(context.queryKey)
			return opts.load((key as Key<S>)[1] as S)
		},
		enabled: key !== null,
		placeholderData: opts.keepPrevious === true ? keepPreviousData : undefined,
	})
	const observer = new QueryObserver<D, Error, D, D, Key<S>>(
		queryClient,
		// `keepPreviousData` is typed for one data type; `D` is that type here.
		options(untrack(opts.key)) as never,
	)
	const [result, setResult] = createSignal<QueryObserverResult<D, Error>>(
		observer.getCurrentResult(),
	)
	onCleanup(observer.subscribe((next) => setResult(() => next)))
	setResult(() => observer.getCurrentResult())
	createComputed(
		on(
			opts.key,
			(key) => {
				observer.setOptions(options(key) as never)
				setResult(() => observer.getCurrentResult())
			},
			{ defer: true },
		),
	)

	// Outdated by a write: refresh now if this pane shows, else when it does.
	// Fetches that started after the write count as current, and marking the
	// key keeps other observers of the query from repeating the request.
	const visible = usePaneVisible()
	createEffect(() => {
		writeSettled()
		const key = opts.key()
		if (visible() && key !== null && !is_current(key)) {
			mark_fetch(key)
			void observer.refetch()
		}
	})

	let reported = 0
	createEffect(() => {
		const r = result()
		if (r.isError && !r.isFetching && r.errorUpdatedAt !== reported) {
			reported = r.errorUpdatedAt
			opts.onError?.(r.error.message)
		}
	})

	const data = createMemo((): T | undefined => {
		const r = result()
		if (r.data !== undefined) {
			return opts.view(r.data)
		}
		return r.isError ? opts.fallback : undefined
	})
	const resource = (() => data()) as QueryResource<T>
	Object.defineProperty(resource, 'loading', {
		get: (): boolean => {
			const r = result()
			return r.isLoading || r.isPlaceholderData
		},
	})
	return [
		resource,
		{
			refetch: async (): Promise<void> => {
				if (untrack(opts.key) !== null) {
					await observer.refetch()
				}
			},
			mutate: (value: D): void => {
				const key = untrack(opts.key)
				if (key !== null) {
					queryClient.setQueryData(key, value)
				}
			},
		},
	]
}

/** Query key of `source` for `load`, stable while the source value stays equal. */
function keyOf<S>(
	load: object,
	source: () => S | null | undefined | false,
): Accessor<Key<S> | null> {
	const id = loaderId(load)
	return createMemo(
		(): Key<S> | null => {
			const value = source()
			return value === null || value === undefined || value === false ? null : [id, value]
		},
		undefined,
		{
			equals: (a: Key<S> | null, b: Key<S> | null): boolean =>
				a === b || (a !== null && b !== null && hashKey(a) === hashKey(b)),
		},
	)
}

async function value_of<T>(res: Promise<Result<T, Error>>): Promise<T> {
	const result = await res
	if (Result.isError(result)) {
		// Query expects a rejection; `observe` turns it back into `onError`.
		throw result.error
	}
	return result.value
}

/** List endpoints answer with a page (`{ items }`) or a plain array. */
type Rows<T> = { items: T[] } | T[]

function items<T>(rows: Rows<T>): T[] {
	return Array.isArray(rows) ? rows : rows.items
}

/** Rows of a list endpoint; a failed fetch reports to `onError` and yields `[]`. */
export function createRows<T>(
	load: () => Promise<Result<Rows<T>, Error>>,
	onError?: ErrorSink,
): [QueryResource<T[]>, { refetch: () => Promise<void> }] {
	const id = loaderId(load)
	return observe<void, Rows<T>, T[]>({
		key: (): Key<void> => [id],
		idle: [id],
		load: () => value_of(load()),
		view: items,
		fallback: [],
		onError,
	})
}

/**
 * Rows refetched whenever `source` changes. Like any source-driven
 * resource, nothing loads while the source is `null`, `undefined` or `false`.
 */
export function createRowsFor<S, T>(
	source: () => S | null | undefined | false,
	load: (value: S) => Promise<Result<Rows<T>, Error>>,
	onError?: ErrorSink,
): [QueryResource<T[]>, { refetch: () => Promise<void> }] {
	return observe<S, Rows<T>, T[]>({
		key: keyOf(load, source),
		idle: [loaderId(load)],
		load: (value: S) => value_of(load(value)),
		view: items,
		fallback: [],
		onError,
	})
}

/**
 * One record for the id (or other key) in `source`; a failed fetch reports
 * to `onError` and yields `null`. A missing key (e.g. a nullable foreign
 * key) loads nothing. `keepPrevious` shows the old value until a new key's
 * answer arrives, flagged as `loading`.
 */
export function createRecord<S, T>(
	source: () => S | null | undefined | false,
	load: (value: S) => Promise<Result<T, Error>>,
	onError?: ErrorSink,
	opts?: { keepPrevious?: boolean },
): QueryReturn<T | null> {
	return observe<S, T | null, T | null>({
		key: keyOf(load, source),
		idle: [loaderId(load)],
		load: (value: S) => value_of(load(value)),
		view: (data: T | null) => data,
		fallback: null,
		onError,
		keepPrevious: opts?.keepPrevious,
	})
}

/** A cached value computed by `load` (best-effort lookups that cannot fail). */
export function createDerived<S, T>(
	source: () => S | null | undefined | false,
	load: (value: S) => Promise<T>,
): QueryResource<T> {
	const [resource] = observe<S, T, T>({
		key: keyOf(load, source),
		idle: [loaderId(load)],
		load,
		view: (data: T) => data,
	})
	return resource
}

/**
 * One record read once, outside the cache: for seeding form fields, which a
 * background refresh must not overwrite while the user types.
 */
export function createSnapshot<S, T>(
	source: () => S | null | undefined | false,
	load: (value: S) => Promise<Result<T, Error>>,
	onError?: ErrorSink,
): ResourceReturn<T | null> {
	return createResource(
		source,
		async (value: S): Promise<T | null> => unwrap(await load(value), null, onError),
	)
}

/**
 * Write requests of a page: `run` clears the error line, flags `pending`
 * while the action runs and reports a failure to `setError`. It resolves to
 * whether the action succeeded, so callers move on only then.
 */
export function useAction(setError: (message: string | null) => void): {
	pending: Accessor<boolean>
	run: (action: () => Promise<Result<unknown, Error>>) => Promise<boolean>
} {
	const [pending, setPending] = createSignal(false)
	return {
		pending,
		run: async (action: () => Promise<Result<unknown, Error>>): Promise<boolean> => {
			setError(null)
			setPending(true)
			const res = await action()
			setPending(false)
			if (Result.isError(res)) {
				setError(res.error.message)
				return false
			}
			return true
		},
	}
}
