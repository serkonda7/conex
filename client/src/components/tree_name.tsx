import type { JSX } from 'solid-js'

/** Nesting level of each row, from the parent links within `rows`. */
export function treeDepths(
	rows: readonly { id: number; parent_id: number | null }[],
): Map<number, number> {
	const parentOf = new Map(rows.map((r) => [r.id, r.parent_id]))
	const out = new Map<number, number>()
	for (const row of rows) {
		let depth = 0
		let parent = row.parent_id
		// The visited set keeps a malformed response from looping forever.
		const visited = new Set<number>([row.id])
		while (parent !== null && parentOf.has(parent) && !visited.has(parent)) {
			visited.add(parent)
			depth += 1
			parent = parentOf.get(parent) ?? null
		}
		out.set(row.id, depth)
	}
	return out
}

/** Name cell indented by its depth, with tree guides for child rows. */
export function TreeName(props: { depth: number; children: JSX.Element }): JSX.Element {
	return (
		<div
			class={`tree-name${props.depth > 0 ? ' tree-child' : ''}`}
			style={{ '--tree-depth': props.depth }}
		>
			{props.children}
		</div>
	)
}
