/**
 * Server-side paging for a list page: the fetched page plus the `pagination`
 * state of its table. The page belongs to the query it was chosen for, so
 * changing the search, a filter or the sort shows page 1 without an extra
 * fetch.
 */
import { Result } from 'better-result'
import type { Page } from 'shared/src/types'
import {
	type Accessor,
	batch,
	createEffect,
	createMemo,
	createResource,
	createSignal,
	type Resource,
} from 'solid-js'
import type { DataTablePagination } from '../components/data_table'
import { historyEntryKey, useTabPath } from './router'

const PAGE_SIZES = [25, 50, 100, 200]
const DEFAULT_PAGE_SIZE = 50
const STORAGE_KEY = 'conex:page-size'

function load_page_size(): number {
	try {
		const stored = Number(window.localStorage.getItem(STORAGE_KEY))
		return PAGE_SIZES.includes(stored) ? stored : DEFAULT_PAGE_SIZE
	} catch {
		return DEFAULT_PAGE_SIZE
	}
}

function save_page_size(size: number): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, String(size))
	} catch {
		// Storage full or unavailable (private mode): the size still applies
		// to this list, it just does not persist.
	}
}

/** A page of a list together with the query it was chosen for. */
interface ListPosition {
	query: string
	page: number
}

/**
 * Last position per history entry. Lists remount when the tab returns to
 * them, and going back must land on the page the user left.
 */
const positions = new Map<string, ListPosition>()

export interface PagedList<Row> {
	page: Resource<Page<Row> | null>
	rows: Accessor<Row[]>
	pagination: Accessor<DataTablePagination>
	onPaginationChange: (next: { page: number; pageSize: number }) => void
	/** Refetches the current page. */
	reload: () => void
}

export function usePagedList<Query extends object, Row>(opts: {
	/** Everything but the page; a new value goes back to page 1. */
	query: Accessor<Query>
	fetch: (query: Query & { page: number; limit: number }) => Promise<Result<Page<Row>, Error>>
	setError: (message: string | null) => void
}): PagedList<Row> {
	const entry = historyEntryKey(useTabPath())
	const query = createMemo(opts.query, undefined, {
		equals: (a: Query, b: Query): boolean => JSON.stringify(a) === JSON.stringify(b),
	})
	const queryKey = (): string => JSON.stringify(query())

	const [position, setPosition] = createSignal<ListPosition>(
		(entry !== null ? positions.get(entry) : undefined) ?? { query: queryKey(), page: 1 },
	)
	const pageNumber = (): number => (position().query === queryKey() ? position().page : 1)
	const [pageSize, setPageSize] = createSignal(load_page_size())

	function goToPage(target: number): void {
		const next = { query: queryKey(), page: target }
		setPosition(next)
		if (entry !== null) {
			positions.set(entry, next)
		}
	}

	const source = createMemo(() => ({ ...query(), page: pageNumber(), limit: pageSize() }))
	const [page, { refetch }] = createResource(source, async (q) => {
		opts.setError(null)
		const res = await opts.fetch(q)
		if (Result.isError(res)) {
			opts.setError(res.error.message)
			return null
		}
		return res.value
	})

	// Deleting the last row of the last page, or rows gone since the list was
	// left, can leave the current page past the end.
	createEffect(() => {
		const current = page()
		if (current && current.items.length === 0 && current.total > 0 && current.page > 1) {
			goToPage(Math.ceil(current.total / current.limit))
		}
	})

	return {
		page,
		rows: () => page()?.items ?? [],
		pagination: () => ({
			page: pageNumber(),
			pageSize: pageSize(),
			rowCount: page()?.total ?? 0,
			pageSizeOptions: PAGE_SIZES,
		}),
		onPaginationChange: (next: { page: number; pageSize: number }): void => {
			if (next.pageSize !== pageSize()) {
				save_page_size(next.pageSize)
			}
			batch(() => {
				setPageSize(next.pageSize)
				goToPage(next.page)
			})
		},
		reload: (): void => void refetch(),
	}
}
