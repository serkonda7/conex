/**
 * Snapping of the floor plan editor, on by default and toggled in the
 * editor (kept per browser in `localStorage`); holding Alt skips it for
 * one drag.
 *
 * - Areas: a drawn, moved or reshaped corner snaps to the corners and then
 *   the edges of the other areas, so neighboring rooms share their borders
 *   instead of overlapping. A moved area snaps by the smallest correction
 *   that puts one of its corners on another area or another area's corner
 *   on it.
 * - Markers: a dragged marker aligns its center horizontally and vertically
 *   with the other markers and the area centers nearby, shown as guide lines.
 *
 * Distances are measured on screen (`Metric`), so the snap range stays the
 * same at every zoom.
 */
import { createSignal } from 'solid-js'

type Point = [number, number]

/** Screen px per plan unit, per axis (the stage size times the zoom). */
export interface Metric {
	sx: number
	sy: number
}

/** Snap range on screen, px. */
const SNAP_PX = 8

/** Alignment range of markers on screen, px. */
const ALIGN_PX = 6

/** Alignment targets farther than this on screen (px) along the guide are ignored. */
const ALIGN_REACH_PX = 600

const STORAGE_KEY = 'conex:floorplan-snap'

function loadSnap(): boolean {
	try {
		return window.localStorage.getItem(STORAGE_KEY) !== 'false'
	} catch {
		return true
	}
}

const [snap, setSnap] = createSignal(loadSnap())

/** Whether the editor snaps areas and aligns markers (on by default). */
export function snapEnabled(): boolean {
	return snap()
}

export function toggleSnap(): void {
	const next = !snap()
	setSnap(next)
	try {
		window.localStorage.setItem(STORAGE_KEY, String(next))
	} catch {
		// Storage unavailable: the choice applies until reload.
	}
}

function screenDistance(metric: Metric, a: Point, b: Point): number {
	return Math.hypot((a[0] - b[0]) * metric.sx, (a[1] - b[1]) * metric.sy)
}

/** Point of segment `a`–`b` closest to `p`, measured on screen. */
function closestOnSegment(metric: Metric, p: Point, a: Point, b: Point): Point {
	const ex = (b[0] - a[0]) * metric.sx
	const ey = (b[1] - a[1]) * metric.sy
	const length = ex * ex + ey * ey
	if (length === 0) {
		return a
	}
	const along = ((p[0] - a[0]) * metric.sx * ex + (p[1] - a[1]) * metric.sy * ey) / length
	const t = Math.min(1, Math.max(0, along))
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Closest point within `range` px of `p` on the polygon edges, or null. */
function closestOnEdges(
	metric: Metric,
	p: Point,
	polygons: Point[][],
	range: number,
): Point | null {
	let best: Point | null = null
	let bestDistance = range
	for (const points of polygons) {
		points.forEach((a: Point, index: number) => {
			const on = closestOnSegment(metric, p, a, points[(index + 1) % points.length])
			const distance = screenDistance(metric, p, on)
			if (distance <= bestDistance) {
				best = on
				bestDistance = distance
			}
		})
	}
	return best
}

/**
 * `p` snapped to the nearest corner of `polygons` in range, else to the
 * nearest point on their edges; null when nothing is in range.
 */
export function snapPoint(metric: Metric, p: Point, polygons: Point[][]): Point | null {
	let best: Point | null = null
	let bestDistance = SNAP_PX
	for (const points of polygons) {
		for (const corner of points) {
			const distance = screenDistance(metric, p, corner)
			if (distance <= bestDistance) {
				best = corner
				bestDistance = distance
			}
		}
	}
	return best ?? closestOnEdges(metric, p, polygons, SNAP_PX)
}

/**
 * The shift of `points` by (`dx`, `dy`), corrected by the smallest amount
 * that snaps one of its corners onto `polygons` or a corner of `polygons`
 * onto its edges, with the point it snapped at.
 */
export function snapShift(
	metric: Metric,
	points: Point[],
	dx: number,
	dy: number,
	polygons: Point[][],
): { dx: number; dy: number; at: Point | null } {
	const moved = points.map((point: Point): Point => [point[0] + dx, point[1] + dy])
	let best: { cx: number; cy: number; at: Point } | null = null
	let bestDistance = Number.POSITIVE_INFINITY
	const consider = (from: Point, to: Point): void => {
		const distance = screenDistance(metric, from, to)
		if (distance < bestDistance) {
			best = { cx: to[0] - from[0], cy: to[1] - from[1], at: to }
			bestDistance = distance
		}
	}
	for (const corner of moved) {
		const to = snapPoint(metric, corner, polygons)
		if (to) {
			consider(corner, to)
		}
	}
	for (const other of polygons) {
		for (const corner of other) {
			const on = closestOnEdges(metric, corner, [moved], SNAP_PX)
			if (on) {
				consider(on, corner)
			}
		}
	}
	const found = best as { cx: number; cy: number; at: Point } | null
	return found ? { dx: dx + found.cx, dy: dy + found.cy, at: found.at } : { dx, dy, at: null }
}

/** Alignment guide through a marker center: a vertical (`x`) or horizontal (`y`) line. */
export interface Guide {
	axis: 'x' | 'y'
	/** Position of the line on its axis. */
	at: number
	/** Extent of the line along the other axis. */
	from: number
	to: number
}

/**
 * `p` aligned on each axis with the closest of `targets` in range (within
 * reach along the other axis), with a guide per aligned axis spanning `p`
 * and every target on that line.
 */
export function alignPoint(
	metric: Metric,
	p: Point,
	targets: Point[],
): { point: Point; guides: Guide[] } {
	const point: Point = [p[0], p[1]]
	const aligned: (0 | 1)[] = []
	for (const axis of [0, 1] as const) {
		const other = axis === 0 ? 1 : 0
		const scale = axis === 0 ? metric.sx : metric.sy
		const otherScale = axis === 0 ? metric.sy : metric.sx
		let best: number | null = null
		let bestDistance = ALIGN_PX
		for (const target of targets) {
			const distance = Math.abs(target[axis] - p[axis]) * scale
			if (
				distance <= bestDistance &&
				Math.abs(target[other] - p[other]) * otherScale <= ALIGN_REACH_PX
			) {
				best = target[axis]
				bestDistance = distance
			}
		}
		if (best !== null) {
			point[axis] = best
			aligned.push(axis)
		}
	}
	const guides = aligned.map((axis: 0 | 1): Guide => {
		const other = axis === 0 ? 1 : 0
		const otherScale = axis === 0 ? metric.sy : metric.sx
		const along = targets
			.filter(
				(target: Point) =>
					Math.abs(target[axis] - point[axis]) < 1e-9 &&
					Math.abs(target[other] - point[other]) * otherScale <= ALIGN_REACH_PX,
			)
			.map((target: Point) => target[other])
		return {
			axis: axis === 0 ? 'x' : 'y',
			at: point[axis],
			from: Math.min(point[other], ...along),
			to: Math.max(point[other], ...along),
		}
	})
	return { point, guides }
}
