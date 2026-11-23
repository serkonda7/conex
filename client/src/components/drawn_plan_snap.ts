/**
 * Snapping of drawn floor plans, in cm on the sheet with the snap range
 * given in cm at the current zoom.
 *
 * A placed point (`snapPoint`) lands on a target point in range, else
 * (drawn from a previous point) keeps a multiple of 15° and ends on a target
 * line it meets, else on a target line; what is left of it aligns with the
 * target points and boxes on screen axes, shown as guides, or takes the grid
 * step.
 *
 * A moved shape (`snapShift`) snaps to other objects: one of its corners on
 * a target point, or else flush against an object, a corner on a target line
 * or a target corner on one of its edges. Flush, it slides along that edge
 * into the next contact (a corner between two walls), or aligns along it
 * with the boxes of other objects. Without contact it aligns its box (edges
 * and center) with the other objects' boxes on each axis, shown as guides,
 * or takes the grid step.
 */
import {
	constrainAngle,
	direction,
	distance,
	type Point,
	projectOnSegment,
	roundTo,
} from './drawn_plan_geometry'
import type { Guide } from './floorplan_snap'

/** A line a point lands on within the snap range or `reach` (cm). */
export interface SnapLine {
	a: Point
	b: Point
	reach: number
}

/** Axis-aligned extent of an object, cm. */
export interface Box {
	x0: number
	y0: number
	x1: number
	y1: number
}

/** What a placed point or moved shape may snap to. */
export interface SnapTargets {
	/** Points it jumps onto, and aligns with. */
	points: Point[]
	/** Lines it lands on or moves flush against. */
	lines: SnapLine[]
	/** Extents of objects a moved shape aligns its edges and center with. */
	boxes: Box[]
}

/** A snapped value with the point it snapped at and the alignment guides it follows. */
export interface Snapped<T> {
	value: T
	mark: Point | null
	guides: Guide[]
}

/** Lines that count as parallel: the sine of their angle is below this. */
const PARALLEL = 0.05

/** Coordinates closer than this (cm) lie on the same guide. */
const SAME_LINE = 0.01

export function boxOf(points: Point[]): Box {
	const xs = points.map((p: Point) => p[0])
	const ys = points.map((p: Point) => p[1])
	return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** The edges of the closed polygon through `points`. */
export function ringEdges(points: Point[]): [Point, Point][] {
	return points.length < 2
		? []
		: points.map((p: Point, i: number): [Point, Point] => [
				p,
				points[(i + 1) % points.length] as Point,
			])
}

function add(p: Point, d: Point): Point {
	return [p[0] + d[0], p[1] + d[1]]
}

function sub(p: Point, q: Point): Point {
	return [p[0] - q[0], p[1] - q[1]]
}

function cross(u: Point, v: Point): number {
	return u[0] * v[1] - u[1] * v[0]
}

/** Signed distance along unit `d` from `p` to where its line meets segment `a`–`b`; `null` when parallel or it misses. */
function rayToSegment(p: Point, d: Point, a: Point, b: Point): number | null {
	const e = sub(b, a)
	const denominator = cross(d, e)
	if (Math.abs(denominator) < 1e-9) {
		return null
	}
	const w = sub(a, p)
	const u = cross(w, d) / denominator
	return u >= 0 && u <= 1 ? cross(w, e) / denominator : null
}

/** The screen axis unit `u` runs along: 0 for x, 1 for y, `null` for neither. */
function axisOf(u: Point): 0 | 1 | null {
	if (Math.abs(u[1]) < 1e-6) {
		return 0
	}
	if (Math.abs(u[0]) < 1e-6) {
		return 1
	}
	return null
}

/** Low edge, center and high edge of a box on an axis. */
function spans(box: Box, axis: 0 | 1): [number, number, number] {
	const [low, high] = axis === 0 ? [box.x0, box.x1] : [box.y0, box.y1]
	return [low, (low + high) / 2, high]
}

/** Everything a shape or point aligns with: the target boxes and points. */
function alignBoxes(targets: SnapTargets): Box[] {
	return [
		...targets.boxes,
		...targets.points.map((p: Point): Box => ({ x0: p[0], y0: p[1], x1: p[0], y1: p[1] })),
	]
}

/**
 * The shift on `axis` (within `range`) that lines up an edge or the center
 * of `box` with one of `others`, and the guide it follows once shifted.
 */
function alignAxis(
	box: Box,
	others: Box[],
	axis: 0 | 1,
	range: number,
): { shift: number; at: number } | null {
	const mine = spans(box, axis)
	let best: { shift: number; at: number } | null = null
	for (const other of others) {
		for (const theirs of spans(other, axis)) {
			for (const value of mine) {
				const shift = theirs - value
				if (Math.abs(shift) <= range && (!best || Math.abs(shift) < Math.abs(best.shift))) {
					best = { shift, at: theirs }
				}
			}
		}
	}
	return best
}

/** The guide on `axis` at `at`, spanning `box` and every one of `others` lined up on it. */
function guideAt(box: Box, others: Box[], axis: 0 | 1, at: number): Guide {
	const low = axis === 0 ? box.y0 : box.x0
	const high = axis === 0 ? box.y1 : box.x1
	let from = low
	let to = high
	for (const other of others) {
		if (spans(other, axis).some((value: number) => Math.abs(value - at) < SAME_LINE)) {
			from = Math.min(from, axis === 0 ? other.y0 : other.x0)
			to = Math.max(to, axis === 0 ? other.y1 : other.x1)
		}
	}
	return { axis: axis === 0 ? 'x' : 'y', at, from, to }
}

/** The shift that lines a box up on `axes`, else puts its corner `anchor` on the grid `step` (0: none). */
function alignOrGrid(
	box: Box,
	anchor: Point,
	targets: SnapTargets,
	axes: (0 | 1)[],
	range: number,
	step: number,
): { shift: Point; guides: Guide[] } {
	const others = alignBoxes(targets)
	const shift: Point = [0, 0]
	const lines: { axis: 0 | 1; at: number }[] = []
	for (const axis of axes) {
		const aligned = alignAxis(box, others, axis, range)
		if (aligned) {
			shift[axis] = aligned.shift
			lines.push({ axis, at: aligned.at })
		} else if (step > 0) {
			shift[axis] = roundTo(anchor[axis], step) - anchor[axis]
		}
	}
	const moved: Box = {
		x0: box.x0 + shift[0],
		y0: box.y0 + shift[1],
		x1: box.x1 + shift[0],
		y1: box.y1 + shift[1],
	}
	return { shift, guides: lines.map(({ axis, at }) => guideAt(moved, others, axis, at)) }
}

/** Nearest target point within `range` of any of `points`, as the shift that lands it. */
function nearestPoint(
	points: Point[],
	targets: Point[],
	range: number,
): { shift: Point; at: Point } | null {
	let best: { shift: Point; at: Point; distance: number } | null = null
	for (const point of points) {
		for (const target of targets) {
			const d = distance(point, target)
			if (d <= range && (!best || d < best.distance)) {
				best = { shift: sub(target, point), at: target, distance: d }
			}
		}
	}
	return best
}

/**
 * The move `delta` of a shape with `corners` and `edges` (as they stand
 * before the move), snapped to `targets` within `range`; see the module
 * comment for the order.
 */
export function snapShift(
	corners: Point[],
	edges: [Point, Point][],
	delta: Point,
	targets: SnapTargets,
	range: number,
	step: number,
): Snapped<Point> {
	if (corners.length === 0) {
		return { value: delta, mark: null, guides: [] }
	}
	const moved = corners.map((p: Point) => add(p, delta))
	const movedEdges = edges.map(([a, b]): [Point, Point] => [add(a, delta), add(b, delta)])

	const onPoint = nearestPoint(moved, targets.points, range)
	if (onPoint) {
		return { value: add(delta, onPoint.shift), mark: onPoint.at, guides: [] }
	}

	// Flush: a corner on a target line, or a target corner on an edge.
	let contact: { shift: Point; along: Point; at: Point; distance: number } | null = null
	for (const corner of moved) {
		for (const line of targets.lines) {
			const hit = projectOnSegment(corner, line.a, line.b)
			if (
				hit.distance <= Math.max(range, line.reach) &&
				(!contact || hit.distance < contact.distance)
			) {
				contact = {
					shift: sub(hit.point, corner),
					along: direction(line.a, line.b),
					at: hit.point,
					distance: hit.distance,
				}
			}
		}
	}
	for (const point of targets.points) {
		for (const [a, b] of movedEdges) {
			const hit = projectOnSegment(point, a, b)
			if (hit.distance <= range && (!contact || hit.distance < contact.distance)) {
				contact = {
					shift: sub(point, hit.point),
					along: direction(a, b),
					at: point,
					distance: hit.distance,
				}
			}
		}
	}
	if (!contact) {
		const { shift, guides } = alignOrGrid(
			boxOf(moved),
			moved[0] as Point,
			targets,
			[0, 1],
			range,
			step,
		)
		return { value: add(delta, shift), mark: null, guides }
	}

	// Slide along the contact into a second one.
	const u = contact.along
	const flush = moved.map((p: Point) => add(p, contact.shift))
	const flushEdges = movedEdges.map(([a, b]): [Point, Point] => [
		add(a, contact.shift),
		add(b, contact.shift),
	])
	let slide: { by: number; at: Point } | null = null
	for (const corner of flush) {
		for (const line of targets.lines) {
			if (Math.abs(cross(u, direction(line.a, line.b))) < PARALLEL) {
				continue
			}
			const by = rayToSegment(corner, u, line.a, line.b)
			if (
				by !== null &&
				Math.abs(by) <= range &&
				(!slide || Math.abs(by) < Math.abs(slide.by))
			) {
				slide = { by, at: [corner[0] + u[0] * by, corner[1] + u[1] * by] }
			}
		}
	}
	const back: Point = [-u[0], -u[1]]
	for (const point of targets.points) {
		for (const [a, b] of flushEdges) {
			if (Math.abs(cross(u, direction(a, b))) < PARALLEL) {
				continue
			}
			const by = rayToSegment(point, back, a, b)
			if (
				by !== null &&
				Math.abs(by) <= range &&
				(!slide || Math.abs(by) < Math.abs(slide.by))
			) {
				slide = { by, at: point }
			}
		}
	}
	const touching = add(delta, contact.shift)
	if (slide) {
		return {
			value: [touching[0] + u[0] * slide.by, touching[1] + u[1] * slide.by],
			mark: slide.at,
			guides: [],
		}
	}
	const axis = axisOf(u)
	if (axis === null) {
		return { value: touching, mark: contact.at, guides: [] }
	}
	const { shift, guides } = alignOrGrid(
		boxOf(flush),
		flush[0] as Point,
		targets,
		[axis],
		range,
		step,
	)
	return { value: add(touching, shift), mark: contact.at, guides }
}

/**
 * A point placed at `raw`, snapped to `targets` within `range`; drawn from
 * `from` (angle constrained, `null` for free) its line keeps a multiple of
 * 15° with a length in `step`s. `clamp` keeps a constructed point on the
 * sheet.
 */
export function snapPoint(
	raw: Point,
	from: Point | null,
	targets: SnapTargets,
	range: number,
	step: number,
	clamp: (p: Point) => Point,
): Snapped<Point> {
	const onPoint = nearestPoint([raw], targets.points, range)
	if (onPoint) {
		return { value: onPoint.at, mark: onPoint.at, guides: [] }
	}
	if (from) {
		const constrained = clamp(constrainAngle(from, raw, step))
		const u = direction(from, constrained)
		for (const line of targets.lines) {
			const by = rayToSegment(from, u, line.a, line.b)
			if (by === null || by <= 0) {
				continue
			}
			const hit: Point = [from[0] + u[0] * by, from[1] + u[1] * by]
			if (distance(hit, constrained) <= Math.max(range, line.reach)) {
				return { value: hit, mark: hit, guides: [] }
			}
		}
		// Along a screen axis the end lines up with the corners of other objects.
		const axis = axisOf(u)
		if (axis !== null && distance(from, constrained) > 0) {
			const box: Box = {
				x0: constrained[0],
				y0: constrained[1],
				x1: constrained[0],
				y1: constrained[1],
			}
			const corners = alignBoxes({ ...targets, boxes: [] })
			const aligned = alignAxis(box, corners, axis, range)
			if (aligned) {
				const value: Point = [...constrained]
				value[axis] = aligned.at
				const end: Box = { x0: value[0], y0: value[1], x1: value[0], y1: value[1] }
				return {
					value: clamp(value),
					mark: null,
					guides: [guideAt(end, corners, axis, aligned.at)],
				}
			}
		}
		return { value: constrained, mark: null, guides: [] }
	}
	let best: { point: Point; distance: number } | null = null
	for (const line of targets.lines) {
		const hit = projectOnSegment(raw, line.a, line.b)
		if (
			hit.distance <= Math.max(range, line.reach) &&
			(!best || hit.distance < best.distance)
		) {
			best = { point: hit.point, distance: hit.distance }
		}
	}
	if (best) {
		return { value: best.point, mark: best.point, guides: [] }
	}
	const box: Box = { x0: raw[0], y0: raw[1], x1: raw[0], y1: raw[1] }
	const { shift, guides } = alignOrGrid(box, raw, { ...targets, boxes: [] }, [0, 1], range, step)
	return { value: clamp(add(raw, shift)), mark: null, guides }
}

/** Distance along unit `u` from `from` to the nearest of `lines` ahead, or `null` when none lies ahead. */
export function rayHit(from: Point, u: Point, lines: SnapLine[]): number | null {
	let best: number | null = null
	for (const line of lines) {
		const by = rayToSegment(from, u, line.a, line.b)
		if (by !== null && by > 1e-6 && (best === null || by < best)) {
			best = by
		}
	}
	return best
}
