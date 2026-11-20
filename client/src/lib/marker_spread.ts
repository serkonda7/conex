/**
 * Pushes overlapping floor plan markers apart by the least distance needed.
 *
 * Markers that do not overlap keep their place, so the view draws them where
 * the editor does; a crowd keeps its arrangement (left stays left).
 */

/** Rounds of pairwise pushing; a crowd settles long before. */
const ROUNDS = 60

/** Overlaps smaller than this (px) count as resolved. */
const EPSILON = 0.01

/**
 * Offsets (px) for markers at `points` (screen px) so that no two lie closer
 * than `gap`. Points flagged in `fixed` stay put and push the others.
 * Markers on the same spot fan out in a fixed direction per index.
 */
export function spreadApart(
	points: readonly (readonly [number, number])[],
	gap: number,
	fixed: readonly boolean[] = [],
): [number, number][] {
	const at = points.map(([x, y]): [number, number] => [x, y])
	const count = at.length
	for (let round = 0; round < ROUNDS; round++) {
		let moved = false
		for (let i = 0; i < count; i++) {
			for (let j = i + 1; j < count; j++) {
				const a = at[i]
				const b = at[j]
				const dx = b[0] - a[0]
				const dy = b[1] - a[1]
				const distance = Math.hypot(dx, dy)
				if (distance >= gap - EPSILON) {
					continue
				}
				const fixedA = fixed[i] === true
				const fixedB = fixed[j] === true
				if (fixedA && fixedB) {
					continue
				}
				let ux: number
				let uy: number
				if (distance < 1e-6) {
					const angle = (j / count) * 2 * Math.PI - Math.PI / 2
					ux = Math.cos(angle)
					uy = Math.sin(angle)
				} else {
					ux = dx / distance
					uy = dy / distance
				}
				const overlap = gap - distance
				const shareA = fixedA ? 0 : fixedB ? 1 : 0.5
				const shareB = 1 - shareA
				a[0] -= ux * overlap * shareA
				a[1] -= uy * overlap * shareA
				b[0] += ux * overlap * shareB
				b[1] += uy * overlap * shareB
				moved = true
			}
		}
		if (!moved) {
			break
		}
	}
	return at.map(([x, y], i): [number, number] => [x - points[i][0], y - points[i][1]])
}
