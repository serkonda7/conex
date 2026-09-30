/** Id → display name maps for table cells and detail grids. */
import { createMemo } from 'solid-js'

/**
 * Resolves ids to names from loaded rows: `—` for no id, the raw id while
 * the rows are loading or when the id is unknown.
 */
export function useNameOf<T extends { id: number }>(
	rows: () => readonly T[] | undefined,
	label: (row: T) => string = (row: T): string => (row as unknown as { name: string }).name,
): (id: number | null | undefined) => string {
	const names = createMemo(() => new Map((rows() ?? []).map((row) => [row.id, label(row)])))
	return (id: number | null | undefined): string =>
		id === null || id === undefined ? '—' : (names().get(id) ?? String(id))
}
