/**
 * Geometry of drawn floor plans: all lengths and coordinates are
 * centimeters on the sheet, x to the right and y down.
 *
 * A wall is a centered strip along its line. It is drawn as pieces between
 * its doors and windows; at its own ends a piece reaches half the thickness
 * past the end (like a square line cap), so walls meeting at a corner close
 * it without a notch.
 */
import type { FloorplanOpening, FloorplanWall, OpeningKind } from 'shared/src/schemas'

export type Point = [number, number]

/** Default thickness of a new wall, cm. */
export const DEFAULT_WALL_THICKNESS = 12

/** Default width of a new door and window, cm. */
export const DEFAULT_OPENING_WIDTH: Record<OpeningKind, number> = { door: 90, window: 120 }

/** Endpoints closer than this (cm) count as the same joint. */
export const SAME_JOINT = 0.5

export function distance(a: Point, b: Point): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1])
}

export function samePoint(a: Point, b: Point): boolean {
	return distance(a, b) < SAME_JOINT
}

/** Unit vector from `a` to `b`; `[1, 0]` for a zero-length segment. */
export function direction(a: Point, b: Point): Point {
	const length = distance(a, b)
	return length === 0 ? [1, 0] : [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
}

/** `p` moved `by` along unit vector `u`. */
export function along(p: Point, u: Point, by: number): Point {
	return [p[0] + u[0] * by, p[1] + u[1] * by]
}

/** Left normal of unit vector `u`, seen from the segment's start on screen (y down). */
function leftNormal(u: Point): Point {
	return [u[1], -u[0]]
}

/** Nearest point of segment `a`–`b` to `p`, with its distance from `a` along the segment. */
export function projectOnSegment(
	p: Point,
	a: Point,
	b: Point,
): { point: Point; offset: number; distance: number } {
	const length = distance(a, b)
	if (length === 0) {
		return { point: a, offset: 0, distance: distance(p, a) }
	}
	const u = direction(a, b)
	const offset = Math.min(length, Math.max(0, (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]))
	const point = along(a, u, offset)
	return { point, offset, distance: distance(p, point) }
}

/** Corners of the strip of thickness `thickness` along `a`–`b`, from `from` to `to` cm. */
function strip(a: Point, b: Point, thickness: number, from: number, to: number): Point[] {
	const u = direction(a, b)
	const n = leftNormal(u)
	const half = thickness / 2
	const p0 = along(a, u, from)
	const p1 = along(a, u, to)
	return [along(p0, n, half), along(p1, n, half), along(p1, n, -half), along(p0, n, -half)]
}

/** Opening's extent along its wall (cm from the wall's start), kept on the wall. */
export function openingSpan(wall: FloorplanWall, opening: FloorplanOpening): [number, number] {
	const length = wallLength(wall)
	const half = Math.min(opening.width, length) / 2
	const center = Math.min(length - half, Math.max(half, opening.offset))
	return [center - half, center + half]
}

export function wallLength(wall: Pick<FloorplanWall, 'a' | 'b'>): number {
	return distance(wall.a, wall.b)
}

/**
 * Polygons of the solid pieces of a wall between its openings. The pieces
 * at the wall's ends reach half the thickness past them.
 */
export function wallPieces(wall: FloorplanWall, openings: FloorplanOpening[]): Point[][] {
	const length = wallLength(wall)
	const half = wall.thickness / 2
	const gaps = openings
		.map((opening: FloorplanOpening) => openingSpan(wall, opening))
		.sort((x, y) => x[0] - y[0])
	const pieces: Point[][] = []
	let at = -half
	for (const [start, end] of gaps) {
		if (start > at) {
			pieces.push(strip(wall.a, wall.b, wall.thickness, at, start))
		}
		at = Math.max(at, end)
	}
	if (length + half > at) {
		pieces.push(strip(wall.a, wall.b, wall.thickness, at, length + half))
	}
	return pieces
}

/** What the stage draws for a door or window. */
export interface OpeningShape {
	/** The opening's jambs on the wall line. */
	start: Point
	end: Point
	/** The gap across the wall's thickness, for the hit area and the window frame. */
	gap: Point[]
	/** Door: the open leaf from the hinge, and the swing arc as an SVG path. */
	leaf: [Point, Point] | null
	arc: string | null
	/** Window: the glass line along the wall. */
	glass: [Point, Point] | null
}

export function openingShape(wall: FloorplanWall, opening: FloorplanOpening): OpeningShape {
	const [from, to] = openingSpan(wall, opening)
	const u = direction(wall.a, wall.b)
	const start = along(wall.a, u, from)
	const end = along(wall.a, u, to)
	const gap = strip(wall.a, wall.b, wall.thickness, from, to)
	if (opening.kind === 'window') {
		return { start, end, gap, leaf: null, arc: null, glass: [start, end] }
	}
	const width = to - from
	const n = leftNormal(u)
	const side = opening.side === 'left' ? 1 : -1
	const hinge = opening.hinge === 'start' ? start : end
	const closed = opening.hinge === 'start' ? end : start
	const open = along(hinge, n, side * width)
	// Sweep from the closed leaf to the open one: the sign of their cross product.
	const cross =
		(closed[0] - hinge[0]) * (open[1] - hinge[1]) -
		(closed[1] - hinge[1]) * (open[0] - hinge[0])
	const sweep = cross > 0 ? 1 : 0
	const arc = `M ${closed[0]} ${closed[1]} A ${width} ${width} 0 0 ${sweep} ${open[0]} ${open[1]}`
	return { start, end, gap, leaf: [hinge, open], arc, glass: null }
}

/** `value` rounded to the nearest multiple of `step`. */
export function roundTo(value: number, step: number): number {
	return Math.round(value / step) * step
}

export function snapToGrid(p: Point, step: number): Point {
	return [roundTo(p[0], step), roundTo(p[1], step)]
}

/**
 * `to` constrained to a multiple of 45° from `from`, its length rounded to
 * `step` (0 keeps it).
 */
export function constrainAngle(from: Point, to: Point, step: number): Point {
	const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
	const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
	const raw = distance(from, to) * Math.cos(angle - snapped)
	const length = step > 0 ? roundTo(raw, step) : raw
	return [from[0] + Math.cos(snapped) * length, from[1] + Math.sin(snapped) * length]
}

export function clampPoint(p: Point, width: number, height: number): Point {
	return [Math.min(width, Math.max(0, p[0])), Math.min(height, Math.max(0, p[1]))]
}

/** Bounding box of every wall end and marker: the smallest sheet that holds the drawing. */
export function contentExtent(walls: FloorplanWall[], markers: { x: number; y: number }[]): Point {
	let [x, y] = [0, 0]
	for (const wall of walls) {
		x = Math.max(x, wall.a[0], wall.b[0])
		y = Math.max(y, wall.a[1], wall.b[1])
	}
	for (const marker of markers) {
		x = Math.max(x, marker.x)
		y = Math.max(y, marker.y)
	}
	return [x, y]
}
