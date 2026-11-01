import type { JSX } from 'solid-js'

/** Full `parent > child` path of each row, from the parent links within `rows`. */
export function treePaths<T extends { id: number; parent_id: number | null; name: string }>(
	rows: readonly T[],
	label: (row: T) => string = (row: T): string => row.name,
): Map<number, string> {
	const byId = new Map(rows.map((r) => [r.id, r]))
	const out = new Map<number, string>()
	for (const row of rows) {
		const trail = [label(row)]
		// The visited set keeps a malformed response from looping forever.
		const visited = new Set<number>([row.id])
		let parent = row.parent_id
		while (parent !== null && !visited.has(parent)) {
			visited.add(parent)
			const node = byId.get(parent)
			if (!node) {
				break
			}
			trail.unshift(label(node))
			parent = node.parent_id
		}
		out.set(row.id, trail.join(' > '))
	}
	return out
}

/** Effective icon of each row: its own, else the nearest ancestor's. */
export function treeIcons(
	rows: readonly { id: number; parent_id: number | null; icon: string | null }[],
): Map<number, string | null> {
	const byId = new Map(rows.map((r) => [r.id, r]))
	const out = new Map<number, string | null>()
	for (const row of rows) {
		let icon = row.icon
		// The visited set keeps a malformed response from looping forever.
		const visited = new Set<number>([row.id])
		let parent = icon == null ? row.parent_id : null
		while (parent !== null && !visited.has(parent)) {
			visited.add(parent)
			const node = byId.get(parent)
			if (!node) {
				break
			}
			if (node.icon != null) {
				icon = node.icon
				break
			}
			parent = node.parent_id
		}
		out.set(row.id, icon)
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
