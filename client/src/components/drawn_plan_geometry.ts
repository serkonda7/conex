/**
 * Geometry of drawn floor plans: all lengths and coordinates are
 * centimeters on the sheet, x to the right and y down.
 *
 * A wall is a centered strip along its line. It is drawn as pieces between
 * its doors and windows; at its own ends a piece reaches half the thickness
 * past the end (like a square line cap), so walls meeting at a corner close
 * it without a notch.
 *
 * Stairs are a strip `width` wide from their foot `a` to their head `b`,
 * divided into treads, with an arrow pointing up the flight.
 */
import type {
	FloorplanOpening,
	FloorplanStair,
	FloorplanWall,
	OpeningKind,
} from 'shared/src/schemas'

export type Point = [number, number]

/** Default thickness of a new wall, cm. */
export const DEFAULT_WALL_THICKNESS = 12

/** Default width of a new door, sliding door and window, cm. */
export const DEFAULT_OPENING_WIDTH: Record<OpeningKind, number> = {
	door: 90,
	sliding_door: 100,
	window: 120,
}

/** Default width of new stairs, cm. */
export const DEFAULT_STAIR_WIDTH = 100

/** Usual depth of one tread, cm: new stairs get as many steps as fit. */
export const TREAD_DEPTH = 28

/** Thickness of a sliding door's panel drawn beside its wall, cm. */
const PANEL_THICKNESS = 4

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
	/** Sliding door: the half-open panel beside the wall, and the arrow it slides along. */
	panel: Point[] | null
	slide: string | null
}

/** SVG path of a line from `from` to `to` with an arrowhead `head` cm long at `to`. */
function arrowPath(from: Point, to: Point, head: number): string {
	const u = direction(from, to)
	const n = leftNormal(u)
	const back = along(to, u, -head)
	const left = along(back, n, head * 0.6)
	const right = along(back, n, -head * 0.6)
	return `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]} M ${left[0]} ${left[1]} L ${to[0]} ${to[1]} L ${right[0]} ${right[1]}`
}

export function openingShape(wall: FloorplanWall, opening: FloorplanOpening): OpeningShape {
	const [from, to] = openingSpan(wall, opening)
	const u = direction(wall.a, wall.b)
	const start = along(wall.a, u, from)
	const end = along(wall.a, u, to)
	const gap = strip(wall.a, wall.b, wall.thickness, from, to)
	const none = { leaf: null, arc: null, glass: null, panel: null, slide: null }
	if (opening.kind === 'window') {
		return { start, end, gap, ...none, glass: [start, end] }
	}
	const width = to - from
	const n = leftNormal(u)
	const side = opening.side === 'left' ? 1 : -1
	if (opening.kind === 'sliding_door') {
		// Half open toward `hinge`: half over the gap, half along the wall.
		const shift = opening.hinge === 'start' ? -width / 2 : width / 2
		const half = wall.thickness / 2
		const face = (at: number, by: number): Point => along(along(wall.a, u, at), n, side * by)
		const panel = [
			face(from + shift, half),
			face(to + shift, half),
			face(to + shift, half + PANEL_THICKNESS),
			face(from + shift, half + PANEL_THICKNESS),
		]
		const tail = opening.hinge === 'start' ? to - width * 0.2 : from + width * 0.2
		const tip = opening.hinge === 'start' ? from + width * 0.2 : to - width * 0.2
		const slide = arrowPath(
			along(wall.a, u, tail),
			along(wall.a, u, tip),
			Math.min(15, width / 4),
		)
		return { start, end, gap, ...none, panel, slide }
	}
	const hinge = opening.hinge === 'start' ? start : end
	const closed = opening.hinge === 'start' ? end : start
	const open = along(hinge, n, side * width)
	// Sweep from the closed leaf to the open one: the sign of their cross product.
	const cross =
		(closed[0] - hinge[0]) * (open[1] - hinge[1]) -
		(closed[1] - hinge[1]) * (open[0] - hinge[0])
	const sweep = cross > 0 ? 1 : 0
	const arc = `M ${closed[0]} ${closed[1]} A ${width} ${width} 0 0 ${sweep} ${open[0]} ${open[1]}`
	return { start, end, gap, ...none, leaf: [hinge, open], arc }
}

/** What the stage draws for stairs. */
export interface StairShape {
	outline: Point[]
	/** Lines between the treads. */
	treads: [Point, Point][]
	/** Arrow up the flight, as an SVG path. */
	arrow: string
}

export function stairShape(stair: Pick<FloorplanStair, 'a' | 'b' | 'width' | 'steps'>): StairShape {
	const length = distance(stair.a, stair.b)
	const u = direction(stair.a, stair.b)
	const n = leftNormal(u)
	const half = stair.width / 2
	const outline = strip(stair.a, stair.b, stair.width, 0, length)
	const steps = Math.max(1, Math.round(stair.steps))
	const depth = length / steps
	const treads = Array.from({ length: steps - 1 }, (_, i): [Point, Point] => {
		const at = along(stair.a, u, depth * (i + 1))
		return [along(at, n, half), along(at, n, -half)]
	})
	const arrow = arrowPath(
		along(stair.a, u, Math.min(depth / 2, length / 4)),
		along(stair.a, u, length - Math.min(depth / 4, length / 8)),
		Math.min(stair.width * 0.25, length / 4, 30),
	)
	return { outline, treads, arrow }
}

/** Steps of new stairs `length` cm long at the usual tread depth. */
export function defaultSteps(length: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(length / TREAD_DEPTH)))
}

/** `value` rounded to the nearest multiple of `step`. */
export function roundTo(value: number, step: number): number {
	return Math.round(value / step) * step
}

/** Angle step walls and scale lines snap to, degrees; it divides 90°. */
export const ANGLE_STEP = 15

/**
 * `to` constrained to a multiple of `ANGLE_STEP` from `from`, its length
 * rounded to `step` (0 keeps it).
 */
export function constrainAngle(from: Point, to: Point, step: number): Point {
	const unit = (ANGLE_STEP * Math.PI) / 180
	const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
	const snapped = Math.round(angle / unit) * unit
	const raw = distance(from, to) * Math.cos(angle - snapped)
	const length = step > 0 ? roundTo(raw, step) : raw
	return [from[0] + Math.cos(snapped) * length, from[1] + Math.sin(snapped) * length]
}

/**
 * Where the line from `from` through `through` crosses segment `a`–`b`
 * ahead of `from`; `null` when it misses or runs parallel.
 */
export function lineHitsSegment(from: Point, through: Point, a: Point, b: Point): Point | null {
	const d: Point = [through[0] - from[0], through[1] - from[1]]
	const e: Point = [b[0] - a[0], b[1] - a[1]]
	const denominator = d[0] * e[1] - d[1] * e[0]
	if (Math.abs(denominator) < 1e-9) {
		return null
	}
	const w: Point = [a[0] - from[0], a[1] - from[1]]
	const t = (w[0] * e[1] - w[1] * e[0]) / denominator
	const u = (w[0] * d[1] - w[1] * d[0]) / denominator
	return t > 0 && u >= 0 && u <= 1 ? [from[0] + d[0] * t, from[1] + d[1] * t] : null
}

export function clampPoint(p: Point, width: number, height: number): Point {
	return [Math.min(width, Math.max(0, p[0])), Math.min(height, Math.max(0, p[1]))]
}

/** Bounding box of every wall and stair end and marker: the smallest sheet that holds the drawing. */
export function contentExtent(
	lines: Pick<FloorplanWall, 'a' | 'b'>[],
	markers: { x: number; y: number }[],
): Point {
	let [x, y] = [0, 0]
	for (const line of lines) {
		x = Math.max(x, line.a[0], line.b[0])
		y = Math.max(y, line.a[1], line.b[1])
	}
	for (const marker of markers) {
		x = Math.max(x, marker.x)
		y = Math.max(y, marker.y)
	}
	return [x, y]
}
