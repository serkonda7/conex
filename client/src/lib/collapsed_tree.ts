import { createSignal } from 'solid-js'
import { readStoredJson, writeStoredJson } from './storage'

const STORAGE_PREFIX = 'conex:collapsed:'

/** Collapsed row ids kept in `localStorage`; ids of deleted rows are harmless. */
function loadCollapsed(key: string): number[] {
	const raw = readStoredJson<unknown>(`${STORAGE_PREFIX}${key}`, [])
	return Array.isArray(raw) ? raw.filter((id): id is number => Number.isInteger(id)) : []
}

function saveCollapsed(key: string, ids: readonly number[]): void {
	writeStoredJson(`${STORAGE_PREFIX}${key}`, ids)
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
