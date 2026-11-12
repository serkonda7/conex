/**
 * Location select options: the full `parent > child` path as label, in tree
 * order (each location right after its parent), so nested locations stay
 * distinguishable and grouped, each with its location type icon.
 */
import type { FormOption } from '../../components/form'
import { treePaths } from '../../components/tree_name'
import { locationTypeIcon } from '../../lib/icons'

interface LocationNode {
	id: number
	parent_id: number | null
	name: string
	type: string
}

/**
 * Options for `rows`, kept in their input order among siblings. With
 * `exclude`, that location and its descendants are left out (a location
 * cannot move under itself).
 */
export function locationOptions(rows: readonly LocationNode[], exclude?: number): FormOption[] {
	const paths = treePaths(rows)
	const ids = new Set(rows.map((r) => r.id))
	const children = new Map<number | null, LocationNode[]>()
	for (const row of rows) {
		// A parent outside `rows` (another tenant's, say) makes it a root here.
		const parent = row.parent_id !== null && ids.has(row.parent_id) ? row.parent_id : null
		const list = children.get(parent)
		if (list) {
			list.push(row)
		} else {
			children.set(parent, [row])
		}
	}
	const out: FormOption[] = []
	// The visited set keeps a malformed response from looping forever.
	const visited = new Set<number>()
	const walk = (parent: number | null): void => {
		for (const row of children.get(parent) ?? []) {
			if (row.id === exclude || visited.has(row.id)) {
				continue
			}
			visited.add(row.id)
			out.push({
				value: row.id,
				label: paths.get(row.id) ?? row.name,
				icon: locationTypeIcon(row.type),
			})
			walk(row.id)
		}
	}
	walk(null)
	return out
}
