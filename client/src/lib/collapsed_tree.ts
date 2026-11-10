import { createSignal } from 'solid-js'

const STORAGE_PREFIX = 'conex:collapsed:'

/** Collapsed row ids kept in `localStorage`; ids of deleted rows are harmless. */
function loadCollapsed(key: string): number[] {
	try {
		const raw: unknown = JSON.parse(
			window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? '[]',
		)
		return Array.isArray(raw) ? raw.filter((id): id is number => Number.isInteger(id)) : []
	} catch {
		return []
	}
}

function saveCollapsed(key: string, ids: readonly number[]): void {
	try {
		window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(ids))
	} catch {
		// Storage unavailable: the collapse still applies until the page closes.
	}
}

export interface CollapsedTree {
	isCollapsed: (id: number) => boolean
	toggle: (id: number) => void
	/** Rows without a collapsed ancestor. */
	visible: <Row extends { ancestor_ids: number[] }>(rows: Row[]) => Row[]
}

/**
 * Collapse state of a tree list, persisted under `conex:collapsed:<key>`.
 * Collapsing hides rows of the current page only, so it keeps the page.
 */
export function createCollapsedTree(key: string): CollapsedTree {
	const [collapsed, setCollapsed] = createSignal<number[]>(loadCollapsed(key))
	const isCollapsed = (id: number): boolean => collapsed().includes(id)
	return {
		isCollapsed,
		toggle: (id: number): void => {
			const next = isCollapsed(id)
				? collapsed().filter((c) => c !== id)
				: [...collapsed(), id]
			setCollapsed(next)
			saveCollapsed(key, next)
		},
		visible: <Row extends { ancestor_ids: number[] }>(rows: Row[]): Row[] =>
			rows.filter((r) => !r.ancestor_ids.some(isCollapsed)),
	}
}
