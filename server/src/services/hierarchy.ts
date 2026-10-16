import { Result } from 'better-result'

/**
 * Pure location-tree helpers. They operate on in-memory parent links so the
 * hierarchy guards and the depth cap are unit-testable without a
 * database; `db/tenancy.ts` loads the rows and delegates the math here.
 */

export interface LocationNode {
	id: number
	parent_id: number | null
}

/** Site groups share the same {id, parent_id} shape; tree math is reused as-is. */
export type TreeNode = LocationNode

/** Builds `child id -> parent id` from sibling rows of one site. */
export function buildParentMap(rows: LocationNode[]): Map<number, number | null> {
	const parents = new Map<number, number | null>()
	for (const row of rows) {
		parents.set(row.id, row.parent_id)
	}
	return parents
}

/** Builds `parent id -> child ids` for subtree walks (null key = roots). */
export function buildChildrenMap(rows: LocationNode[]): Map<number | null, number[]> {
	const children = new Map<number | null, number[]>()
	for (const row of rows) {
		const list = children.get(row.parent_id)
		if (list) {
			list.push(row.id)
		} else {
			children.set(row.parent_id, [row.id])
		}
	}
	return children
}

/**
 * Depth of a node counting the root as 1. Errs on unknown ids and on chains
 * that never reach a root (cycle or corrupt data); the iteration bound keeps
 * a hostile chain from looping forever.
 */
export function depthOf(
	nodeId: number,
	parents: Map<number, number | null>,
): Result<number, Error> {
	if (!parents.has(nodeId)) {
		return Result.err(new Error(`Location "${nodeId}" does not exist`))
	}
	let depth = 0
	let current: number | null = nodeId
	const seen = new Set<number>()
	while (current !== null) {
		if (seen.has(current)) {
			return Result.err(new Error(`Location hierarchy contains a cycle at "${current}"`))
		}
		seen.add(current)
		depth += 1
		if (depth > 1024) {
			return Result.err(new Error('Location hierarchy is too deep to evaluate'))
		}
		const parent = parents.get(current)
		if (parent === undefined) {
			return Result.err(new Error(`Location "${current}" does not exist`))
		}
		current = parent
	}
	return Result.ok(depth)
}

/**
 * True when re-parenting `movingId` under `newParentId` would create a cycle:
 * the new parent is the node itself or one of its descendants.
 */
export function createsCycle(
	movingId: number,
	newParentId: number,
	parents: Map<number, number | null>,
): boolean {
	let current: number | null | undefined = newParentId
	const seen = new Set<number>()
	while (current !== null && current !== undefined) {
		if (current === movingId) {
			return true
		}
		if (seen.has(current)) {
			return true
		}
		seen.add(current)
		current = parents.get(current) ?? null
	}
	return false
}

/**
 * Deepest descendant offset below `nodeId` (0 when childless). Added to the
 * node's new depth to check the depth cap on moves.
 */
export function maxDescendantOffset(
	nodeId: number,
	children: Map<number | null, number[]>,
): number {
	let maxOffset = 0
	const stack: Array<{ id: number; offset: number }> = [{ id: nodeId, offset: 0 }]
	const seen = new Set<number>([nodeId])
	while (stack.length > 0) {
		const next = stack.pop()
		if (!next) {
			continue
		}
		const kids = children.get(next.id) ?? []
		for (const kid of kids) {
			if (seen.has(kid)) {
				continue
			}
			seen.add(kid)
			const offset = next.offset + 1
			if (offset > maxOffset) {
				maxOffset = offset
			}
			stack.push({ id: kid, offset })
		}
	}
	return maxOffset
}

/**
 * Ids of `nodeId` and every node below it, for filters that match a whole
 * subtree (e.g. devices of a role including its child roles).
 */
export function subtreeIds(nodeId: number, children: Map<number | null, number[]>): number[] {
	const ids = [nodeId]
	const seen = new Set<number>(ids)
	for (let i = 0; i < ids.length; i += 1) {
		for (const kid of children.get(ids[i] as number) ?? []) {
			if (!seen.has(kid)) {
				seen.add(kid)
				ids.push(kid)
			}
		}
	}
	return ids
}

/**
 * Sort rows as a preorder tree: roots and each sibling group are sorted by
 * the requested field, while every parent stays immediately before its
 * descendants. This keeps the API order aligned with indented list views.
 */
export function sortHierarchically<
	Row extends LocationNode & { name: string },
	Field extends keyof Row & string,
>(rows: Row[], sort: Field, order: 'asc' | 'desc'): Row[] {
	const children = new Map<number | null, Row[]>()
	const included = new Set(rows.map((row) => row.id))
	for (const row of rows) {
		// A filtered result may omit a row's parent; treat that row as a root in
		// the returned subset rather than hiding it from the tree.
		const parentId =
			row.parent_id !== null && included.has(row.parent_id) ? row.parent_id : null
		const siblings = children.get(parentId)
		if (siblings) {
			siblings.push(row)
		} else {
			children.set(parentId, [row])
		}
	}

	const collate = (a: string, b: string): number =>
		a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
	const direction = order === 'desc' ? -1 : 1
	const compare = (a: Row, b: Row): number => {
		const byField = collate(String(a[sort] ?? ''), String(b[sort] ?? ''))
		if (byField !== 0) {
			return byField * direction
		}
		// Stable tie-breakers make pagination deterministic when sibling values
		// are equal (and match the selected direction for the name tie-breaker).
		const byName = collate(a.name, b.name)
		return (byName !== 0 ? byName : a.id - b.id) * direction
	}

	const sorted: Row[] = []
	const visited = new Set<number>()
	const visit = (parentId: number | null): void => {
		const siblings = children.get(parentId)
		if (!siblings) {
			return
		}
		siblings.sort(compare)
		for (const row of siblings) {
			// Guards against cycles in corrupt data.
			if (visited.has(row.id)) {
				continue
			}
			visited.add(row.id)
			sorted.push(row)
			visit(row.id)
		}
	}
	visit(null)
	return sorted
}
