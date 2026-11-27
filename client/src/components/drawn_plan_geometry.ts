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
 * divided into treads, with an arrow pointing up the flight. A cable tray and
 * a room divider are strips like a wall. A pillar is a rectangle or an
 * ellipse around its center, turned by its rotation. A desk stands on its back edge `a`–`b` and reaches
 * `depth` to the left of it. A desk group is three desks around a center,
 * 120° apart, split by dividers; each desk's sides leave the outer ends of
 * its dividers at a right angle, and its front edge curves in.
 */
import {
	deskGroupFrontHalf,
	type FloorplanDesk,
	type FloorplanDeskGroup,
	type FloorplanOpening,
	type FloorplanPartition,
	type FloorplanPillar,
	type FloorplanStair,
	type FloorplanWall,
	type OpeningKind,
} from 'shared/src/schemas'

export type Point = [number, number]

/*
 * Defaults of new elements follow common German building practice.
 */

/** Default thickness of a new wall, cm: an 11.5 cm interior masonry wall. */
export const DEFAULT_WALL_THICKNESS = 11.5

/**
 * Default width of a new door, sliding door and window, cm: the rough
 * openings (Rohbaurichtmaß) of a standard door (DIN 18101, 885 mm) and a
 * wide one (1010 mm), and a window on the eighth-meter grid (1135 mm).
 */
export const DEFAULT_OPENING_WIDTH: Record<OpeningKind, number> = {
	door: 88.5,
	sliding_door: 101,
	window: 113.5,
}

/** Default width of new stairs, cm: the usual clear width (DIN 18065). */
export const DEFAULT_STAIR_WIDTH = 100

/** Default side of a new pillar, cm: a 30 × 30 cm reinforced concrete column. */
export const DEFAULT_PILLAR_SIDE = 30

/** Default thickness of a new room divider, cm: an office partition screen. */
export const DEFAULT_PARTITION_THICKNESS = 5

/** Straight pieces a round pillar is drawn with. */
const PILLAR_SEGMENTS = 32

/** Default width of a new cable tray, cm: a 300 mm tray. */
export const DEFAULT_TRAY_WIDTH = 30

/** Default length of a desk put down with one click, cm: a 160 × 80 cm desk (ASR A1.2). */
export const DEFAULT_DESK_LENGTH = 160

/** Default depth of a new desk, cm. */
export const DEFAULT_DESK_DEPTH = 80

/** Divider length, depth (center to front corners) and front curve of a new desk group, cm. */
export const DEFAULT_DESK_GROUP = { arm: 118, depth: 126, curve: 18 } as const

/** Desks in a desk group. */
export const DESK_GROUP_DESKS = [0, 1, 2] as const

/** Straight pieces a desk group's curved front edge is drawn with. */
const ARC_SEGMENTS = 16

/** Usual depth of one tread, cm (17/29 stairs, DIN 18065): new stairs get as many steps as fit. */
export const TREAD_DEPTH = 29

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

/** Corners of a desk: back edge `a`, `b`, then the front edge. */
export function deskOutline(desk: Pick<FloorplanDesk, 'a' | 'b' | 'depth'>): Point[] {
	const n = leftNormal(direction(desk.a, desk.b))
	return [desk.a, desk.b, along(desk.b, n, desk.depth), along(desk.a, n, desk.depth)]
}

/** What places and sizes a pillar. */
export type PillarShapeOf = Pick<
	FloorplanPillar,
	'center' | 'shape' | 'width' | 'depth' | 'rotation'
>

/** `p` of a pillar's own frame (x along its width, y along its depth) on the sheet. */
function pillarPoint(pillar: PillarShapeOf, x: number, y: number): Point {
	const u = heading(pillar.rotation)
	const v: Point = [-u[1], u[0]]
	return [pillar.center[0] + u[0] * x + v[0] * y, pillar.center[1] + u[1] * x + v[1] * y]
}

/** Outline of a pillar: its four corners, or a round one's circumference in straight pieces. */
export function pillarOutline(pillar: PillarShapeOf): Point[] {
	const [w, d] = [pillar.width / 2, pillar.depth / 2]
	if (pillar.shape === 'round') {
		return Array.from({ length: PILLAR_SEGMENTS }, (_, i): Point => {
			const angle = (2 * Math.PI * i) / PILLAR_SEGMENTS
			return pillarPoint(pillar, w * Math.cos(angle), d * Math.sin(angle))
		})
	}
	return [
		pillarPoint(pillar, -w, -d),
		pillarPoint(pillar, w, -d),
		pillarPoint(pillar, w, d),
		pillarPoint(pillar, -w, d),
	]
}

/**
 * The points of a pillar other things snap to and it snaps with: a
 * rectangle's corners, a round pillar's center and the ends of its axes.
 */
export function pillarCorners(pillar: PillarShapeOf): Point[] {
	if (pillar.shape === 'rect') {
		return pillarOutline(pillar)
	}
	const [w, d] = [pillar.width / 2, pillar.depth / 2]
	return [
		pillar.center,
		pillarPoint(pillar, w, 0),
		pillarPoint(pillar, 0, d),
		pillarPoint(pillar, -w, 0),
		pillarPoint(pillar, 0, -d),
	]
}

/** The straight edges of a pillar: a rectangle's sides, none of a round one. */
export function pillarEdges(pillar: PillarShapeOf): [Point, Point][] {
	if (pillar.shape === 'round') {
		return []
	}
	const corners = pillarOutline(pillar)
	return corners.map((p: Point, i: number): [Point, Point] => [
		p,
		corners[(i + 1) % corners.length] as Point,
	])
}

/** Outline of a room divider: a strip reaching half its thickness past its ends, like a wall. */
export function partitionOutline(
	partition: Pick<FloorplanPartition, 'a' | 'b' | 'thickness'>,
): Point[] {
	const half = partition.thickness / 2
	return strip(
		partition.a,
		partition.b,
		partition.thickness,
		-half,
		distance(partition.a, partition.b) + half,
	)
}

/** The shape of a desk group, without its links. */
export type DeskGroupShape = Pick<
	FloorplanDeskGroup,
	'center' | 'rotation' | 'arm' | 'depth' | 'curve'
>

/** Unit vector `degrees` clockwise from the x axis on screen (y down). */
function heading(degrees: number): Point {
	const radians = (degrees * Math.PI) / 180
	return [Math.cos(radians), Math.sin(radians)]
}

/** Direction desk `index` of a group faces, degrees: the first one down at rotation 0. */
function deskFacing(group: DeskGroupShape, index: number): number {
	return group.rotation + 90 + 120 * index
}

/** Outer ends of a desk group's three dividers, the first one up at rotation 0. */
export function deskGroupArms(group: DeskGroupShape): Point[] {
	return DESK_GROUP_DESKS.map((index: number) =>
		along(group.center, heading(deskFacing(group, index) + 180), group.arm),
	)
}

/**
 * Corners of desk `index` of a group: the divider ends on either side and
 * the front corners, from the divider before it clockwise.
 */
function deskCorners(
	group: DeskGroupShape,
	index: number,
): { armA: Point; frontA: Point; frontB: Point; armB: Point } {
	const facing = deskFacing(group, index)
	const side = ((group.depth - group.arm / 2) * 2) / Math.sqrt(3)
	const armA = along(group.center, heading(facing - 60), group.arm)
	const armB = along(group.center, heading(facing + 60), group.arm)
	return {
		armA,
		frontA: along(armA, heading(facing + 30), side),
		frontB: along(armB, heading(facing - 30), side),
		armB,
	}
}

/**
 * Outline of desk `index` (0–2) of a group: the center, a divider end, the
 * front corners with the curved front edge between them, and the other
 * divider end.
 */
export function deskGroupDesk(group: DeskGroupShape, index: number): Point[] {
	const { armA, frontA, frontB, armB } = deskCorners(group, index)
	const half = deskGroupFrontHalf(group.arm, group.depth)
	const curve = Math.min(group.curve, half)
	if (curve <= 0 || half <= 0) {
		return [group.center, armA, frontA, frontB, armB]
	}
	// The front edge is an arc through both front corners, `curve` deep.
	const u = heading(deskFacing(group, index))
	const p = direction(frontA, frontB)
	const radius = (half * half + curve * curve) / (2 * curve)
	const circle = along(group.center, u, group.depth - curve + radius)
	const reach = Math.asin(Math.min(1, half / radius))
	const arc: Point[] = []
	for (let i = 1; i < ARC_SEGMENTS; i++) {
		const angle = -reach + (2 * reach * i) / ARC_SEGMENTS
		arc.push(along(along(circle, u, -radius * Math.cos(angle)), p, radius * Math.sin(angle)))
	}
	return [group.center, armA, frontA, ...arc, frontB, armB]
}

/** The corners of a desk group other things snap to: the center, divider ends and front corners. */
export function deskGroupCorners(group: DeskGroupShape): Point[] {
	return [
		group.center,
		...deskGroupArms(group),
		...DESK_GROUP_DESKS.flatMap((index: number) => {
			const { frontA, frontB } = deskCorners(group, index)
			return [frontA, frontB]
		}),
	]
}

/** The straight outer edges of a desk group: from each divider end to the front corners beside it. */
export function deskGroupEdges(group: DeskGroupShape): [Point, Point][] {
	return DESK_GROUP_DESKS.flatMap((index: number): [Point, Point][] => {
		const { armA, frontA, frontB, armB } = deskCorners(group, index)
		return [
			[armA, frontA],
			[armB, frontB],
		]
	})
}

/** Center of mass of a polygon; the mean of its corners when it has no area. */
export function polygonCenter(points: Point[]): Point {
	let area = 0
	let x = 0
	let y = 0
	for (let i = 0; i < points.length; i++) {
		const [x0, y0] = points[i] as Point
		const [x1, y1] = points[(i + 1) % points.length] as Point
		const cross = x0 * y1 - x1 * y0
		area += cross
		x += (x0 + x1) * cross
		y += (y0 + y1) * cross
	}
	if (Math.abs(area) < 1e-9) {
		const n = Math.max(1, points.length)
		return [
			points.reduce((sum, p) => sum + p[0], 0) / n,
			points.reduce((sum, p) => sum + p[1], 0) / n,
		]
	}
	return [x / (3 * area), y / (3 * area)]
}

/** Where the lines through `a`–`b` and `c`–`d` cross; `null` when parallel. */
function lineCross(a: Point, b: Point, c: Point, d: Point): Point | null {
	const r: Point = [b[0] - a[0], b[1] - a[1]]
	const s: Point = [d[0] - c[0], d[1] - c[1]]
	const denominator = r[0] * s[1] - r[1] * s[0]
	if (Math.abs(denominator) < 1e-9) {
		return null
	}
	const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denominator
	return [a[0] + r[0] * t, a[1] + r[1] * t]
}

/** The two faces of a wall, reaching half the thickness past its ends like its pieces. */
function wallFaces(wall: Pick<FloorplanWall, 'a' | 'b' | 'thickness'>): [Point, Point][] {
	const [p0, p1, p2, p3] = strip(
		wall.a,
		wall.b,
		wall.thickness,
		-wall.thickness / 2,
		wallLength(wall) + wall.thickness / 2,
	) as [Point, Point, Point, Point]
	return [
		[p0, p1],
		[p3, p2],
	]
}

/**
 * Snap targets on the walls' faces, for what stands against a wall (desks,
 * rooms, trays): the faces, and the corners where the faces of walls joined
 * at an end meet (inside and outside), or a free end's corners.
 */
export function wallFaceTargets(walls: Pick<FloorplanWall, 'a' | 'b' | 'thickness'>[]): {
	points: Point[]
	faces: [Point, Point][]
} {
	const faces = walls.map(wallFaces)
	const points: Point[] = []
	walls.forEach((wall, i: number) => {
		for (const end of [wall.a, wall.b]) {
			const joined = walls.flatMap((other, j: number) =>
				j !== i && (samePoint(other.a, end) || samePoint(other.b, end)) ? [j] : [],
			)
			if (joined.length === 0) {
				const cap = end === wall.a ? 0 : 1
				for (const face of faces[i] ?? []) {
					points.push(face[cap])
				}
				continue
			}
			for (const j of joined) {
				if (j < i) {
					continue
				}
				const reach = Math.max(wall.thickness, walls[j]?.thickness ?? 0) * 2
				for (const mine of faces[i] ?? []) {
					for (const theirs of faces[j] ?? []) {
						const hit = lineCross(mine[0], mine[1], theirs[0], theirs[1])
						if (hit && distance(hit, end) <= reach) {
							points.push(hit)
						}
					}
				}
			}
		}
	})
	return { points, faces: faces.flat() }
}

/** Opening's extent along its wall (cm from the wall's start), kept on the wall. */
/** What places a door or window along its wall, and how it opens. */
export type OpeningPlan = Pick<FloorplanOpening, 'kind' | 'offset' | 'width' | 'hinge' | 'side'>

export function openingSpan(wall: FloorplanWall, opening: OpeningPlan): [number, number] {
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
export function wallPieces(wall: FloorplanWall, openings: OpeningPlan[]): Point[][] {
	const length = wallLength(wall)
	const half = wall.thickness / 2
	const gaps = openings
		.map((opening: OpeningPlan) => openingSpan(wall, opening))
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
	/** Points around everything drawn (the swing arc, the panel), for the selection's box. */
	extent: Point[]
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

export function openingShape(wall: FloorplanWall, opening: OpeningPlan): OpeningShape {
	const [from, to] = openingSpan(wall, opening)
	const u = direction(wall.a, wall.b)
	const start = along(wall.a, u, from)
	const end = along(wall.a, u, to)
	const gap = strip(wall.a, wall.b, wall.thickness, from, to)
	const none = { leaf: null, arc: null, glass: null, panel: null, slide: null, extent: gap }
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
		return { start, end, gap, ...none, panel, slide, extent: [...gap, ...panel] }
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
	// The quarter circle from the closed leaf to the open one.
	const shut = direction(hinge, closed)
	const swing = Array.from({ length: 7 }, (_, i): Point => {
		const angle = (Math.PI / 2) * (i / 6)
		return along(along(hinge, shut, width * Math.cos(angle)), n, side * width * Math.sin(angle))
	})
	return { start, end, gap, ...none, leaf: [hinge, open], arc, extent: [...gap, ...swing] }
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

export function clampPoint(p: Point, width: number, height: number): Point {
	return [Math.min(width, Math.max(0, p[0])), Math.min(height, Math.max(0, p[1]))]
}

/** Bounding box of every drawn point and marker: the smallest sheet that holds the drawing. */
export function contentExtent(points: Point[], markers: { x: number; y: number }[]): Point {
	let [x, y] = [0, 0]
	for (const point of points) {
		x = Math.max(x, point[0])
		y = Math.max(y, point[1])
	}
	for (const marker of markers) {
		x = Math.max(x, marker.x)
		y = Math.max(y, marker.y)
	}
	return [x, y]
}
