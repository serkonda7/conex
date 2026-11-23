/**
 * Three.js scene of a drawn floor plan for the 3D view: the plan's walls,
 * doors, windows, stairs, cable trays, desks, desk groups and rooms at their
 * stored heights, and stand-ins for the racks, devices and outlets at their
 * mounting heights (a rack as tall as its rack type's units).
 *
 * World units are the sheet's centimeters. Sheet x is world x, sheet y
 * (down on screen) is world z, and world y points up, so the plan seen from
 * above with the camera to the south reads like the 2D drawing.
 *
 * Everything of one look is merged into one mesh, so even large plans take
 * few draw calls.
 */

import { DEFAULT_WALL_HEIGHT } from 'shared/src/schemas'
import {
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	EdgesGeometry,
	ExtrudeGeometry,
	Group,
	LineBasicMaterial,
	LineSegments,
	type Material,
	Mesh,
	MeshStandardMaterial,
	type Object3D,
	Plane,
	PlaneGeometry,
	Shape,
	ShapeGeometry,
	SRGBColorSpace,
	type Texture,
	TextureLoader,
	Vector2,
	Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { attachment_file_url } from '../api/attachments'
import type { FloorplanDrawingJson, FloorplanDrawingPlacementJson } from '../api/floorplan_drawings'
import {
	along,
	DESK_GROUP_DESKS,
	deskGroupArms,
	deskGroupCorners,
	deskGroupDesk,
	deskOutline,
	direction,
	distance,
	openingShape,
	type Point,
	polygonCenter,
	wallPieces,
} from './drawn_plan_geometry'

/** Sizes the plan does not record, cm. */
const SIZES = {
	/** Thickness of a desk top. */
	deskTop: 3,
	/** How far the screens on a desk group's dividers reach above the desks. */
	screen: 46,
	/** Height of a cable tray's sides: the usual 60 mm. */
	tray: 6,
	/** A rack without a rack type. */
	rack: 200,
	/** Plinth and roof of a rack, besides its units. */
	rackFrame: 13,
	/** How far a rack's marker floats above its top. */
	rackMarker: 15,
} as const

/** Height of one rack unit, cm. */
const RACK_UNIT = 4.445

/** Footprint side of a rack stand-in, cm (racks carry no size or rotation on the plan). */
const RACK_SIDE = 60

/** Thickness of a door leaf, a window pane, a desk leg and a divider screen, cm. */
const LEAF = 4
const PANE = 2
const LEG = 5
const SCREEN = 3

/** Faces meeting at more than this angle (degrees) get an edge line. */
const CREASE_ANGLE = 30

/** Height of a rack's cabinet, cm: its rack type's units with plinth and roof. */
function rackHeight(placement: Pick<FloorplanDrawingPlacementJson, 'rack_units'>): number {
	return placement.rack_units === null
		? SIZES.rack
		: placement.rack_units * RACK_UNIT + SIZES.rackFrame
}

/** Marker height above the floor: a rack's above its top, a device's and outlet's where mounted. */
export function markerHeight(placement: FloorplanDrawingPlacementJson): number {
	return placement.rack_id === null
		? placement.elevation
		: placement.elevation + rackHeight(placement) + SIZES.rackMarker
}

/** The highest wall of `drawing`, cm; a usual storey without walls. */
export function tallestWall(drawing: Pick<FloorplanDrawingJson, 'walls'>): number {
	return drawing.walls.reduce(
		(highest: number, wall) => Math.max(highest, wall.height),
		drawing.walls.length === 0 ? DEFAULT_WALL_HEIGHT : 0,
	)
}

/** Colors of the scene, read from the theme. */
export interface SceneColors {
	background: string
	floor: string
	wall: string
	door: string
	glass: string
	room: string
	stair: string
	tray: string
	desk: string
	deskLinked: string
	rack: string
	pole: string
	edge: string
}

/** What the 3D view adds to its scene and disposes again. */
export interface PlanScene {
	root: Group
	/** The walls and doors: what hides markers and labels behind it. */
	occluders: Object3D[]
	/** Releases the scene's geometries, materials and textures. */
	dispose: () => void
}

/** Point `p` of the sheet at height `y`, in world coordinates. */
export function worldPoint(p: Point, y: number): Vector3 {
	return new Vector3(p[0], y, p[1])
}

/** Corners of a strip `width` wide along `a`–`b`, from `from` to `to` cm along it. */
function strip(a: Point, b: Point, width: number, from: number, to: number): Point[] {
	const u = direction(a, b)
	const n: Point = [u[1], -u[0]]
	const half = width / 2
	const p0 = along(a, u, from)
	const p1 = along(a, u, to)
	return [along(p0, n, half), along(p1, n, half), along(p1, n, -half), along(p0, n, -half)]
}

/** Square of side `side` centered on `p`, axis aligned. */
function square(p: Point, side: number): Point[] {
	const h = side / 2
	return [
		[p[0] - h, p[1] - h],
		[p[0] + h, p[1] - h],
		[p[0] + h, p[1] + h],
		[p[0] - h, p[1] + h],
	]
}

/** `p` moved `by` cm toward `to` (not past it). */
function toward(p: Point, to: Point, by: number): Point {
	return along(p, direction(p, to), Math.min(by, distance(p, to)))
}

/** Polygon `points` of the sheet raised from `bottom` to `top` cm. */
function prism(points: Point[], bottom: number, top: number): BufferGeometry | null {
	if (points.length < 3 || top <= bottom) {
		return null
	}
	const shape = new Shape(points.map((p: Point) => new Vector2(p[0], p[1])))
	const geometry = new ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false })
	// The shape lies in x/y and extrudes along +z: turn it to x/z, extruded down, then lift it.
	geometry.rotateX(Math.PI / 2)
	geometry.translate(0, top, 0)
	return geometry
}

/** Flat polygon on the floor at height `y`, facing up. */
function flat(points: Point[], y: number): BufferGeometry | null {
	if (points.length < 3) {
		return null
	}
	const geometry = new ShapeGeometry(new Shape(points.map((p) => new Vector2(p[0], p[1]))))
	geometry.rotateX(Math.PI / 2)
	geometry.translate(0, y, 0)
	return geometry
}

/** Collects geometries per look and merges each look into one mesh. */
class Batch {
	private readonly parts = new Map<Material, BufferGeometry[]>()

	add(material: Material, geometry: BufferGeometry | null): void {
		if (!geometry) {
			return
		}
		const list = this.parts.get(material) ?? []
		// Merging needs the same attributes everywhere: drop the index and the uvs.
		const plain = geometry.index ? geometry.toNonIndexed() : geometry
		if (plain !== geometry) {
			geometry.dispose()
		}
		plain.deleteAttribute('uv')
		list.push(plain)
		this.parts.set(material, list)
	}

	/** One mesh per material, with `edges` drawn along the creases of the solid ones. */
	meshes(edges: Map<Material, LineBasicMaterial>): Object3D[] {
		const out: Object3D[] = []
		for (const [material, list] of this.parts) {
			const merged = mergeGeometries(list)
			for (const part of list) {
				part.dispose()
			}
			if (!merged) {
				continue
			}
			const mesh = new Mesh(merged, material)
			out.push(mesh)
			const edge = edges.get(material)
			if (edge) {
				out.push(new LineSegments(new EdgesGeometry(merged, CREASE_ANGLE), edge))
			}
		}
		return out
	}
}

/** Lines of the outlines `rings` at height `y`, as line segments. */
function outlineSegments(rings: Point[][], y: number): BufferGeometry {
	const positions: number[] = []
	for (const ring of rings) {
		ring.forEach((p: Point, i: number) => {
			const q = ring[(i + 1) % ring.length] as Point
			positions.push(p[0], y, p[1], q[0], y, q[1])
		})
	}
	const geometry = new BufferGeometry()
	geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
	return geometry
}

/**
 * Builds the scene of `drawing`. The reference image, when given, lies on
 * the floor at `opacity`, clipped to the sheet; `on_load` runs once its
 * texture arrived, so the view renders again.
 */
export function buildPlanScene(
	drawing: FloorplanDrawingJson,
	colors: SceneColors,
	reference: { opacity: number; on_load: () => void } | null,
): PlanScene {
	const root = new Group()
	const materials: Material[] = []
	const textures: Texture[] = []
	const solid = (
		color: string,
		extra: Partial<MeshStandardMaterial> = {},
	): MeshStandardMaterial => {
		const material = new MeshStandardMaterial({ color: new Color(color), roughness: 0.9 })
		Object.assign(material, extra)
		materials.push(material)
		return material
	}
	const see = (color: string, opacity: number): MeshStandardMaterial =>
		solid(color, { transparent: true, opacity, depthWrite: false, side: DoubleSide })
	const line = (color: string, opacity = 1): LineBasicMaterial => {
		const material = new LineBasicMaterial({
			color: new Color(color),
			transparent: opacity < 1,
			opacity,
		})
		materials.push(material)
		return material
	}

	const wall = solid(colors.wall)
	const door = solid(colors.door)
	const glass = see(colors.glass, 0.35)
	const stair = solid(colors.stair)
	const tray = see(colors.tray, 0.6)
	const desk = solid(colors.desk)
	const deskLinked = solid(colors.deskLinked)
	const screen = solid(colors.door)
	const rack = solid(colors.rack)
	const pole = solid(colors.pole)
	const edges = new Map<Material, LineBasicMaterial>([
		[stair, line(colors.edge, 0.6)],
		[desk, line(colors.edge, 0.6)],
		[deskLinked, line(colors.edge, 0.6)],
		[rack, line(colors.edge, 0.8)],
	])
	const batch = new Batch()

	// The floor: the sheet, then the reference image and the rooms just above it.
	const floor = new Mesh(new PlaneGeometry(drawing.width, drawing.height), solid(colors.floor))
	floor.rotateX(-Math.PI / 2)
	floor.position.set(drawing.width / 2, 0, drawing.height / 2)
	root.add(floor)

	const ref = drawing.reference
	if (ref && reference) {
		const height = (ref.width * ref.attachment.height_px) / ref.attachment.width_px
		const material = new MeshStandardMaterial({
			transparent: true,
			opacity: reference.opacity,
			depthWrite: false,
			roughness: 1,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
			// Clipped to the sheet: a moved or scaled image may stick out of it.
			clippingPlanes: [
				new Plane(new Vector3(1, 0, 0), 0),
				new Plane(new Vector3(-1, 0, 0), drawing.width),
				new Plane(new Vector3(0, 0, 1), 0),
				new Plane(new Vector3(0, 0, -1), drawing.height),
			],
		})
		materials.push(material)
		const texture = new TextureLoader().load(attachment_file_url(ref.attachment), () =>
			reference.on_load(),
		)
		texture.colorSpace = SRGBColorSpace
		textures.push(texture)
		material.map = texture
		const image = new Mesh(new PlaneGeometry(ref.width, height), material)
		image.rotateX(-Math.PI / 2)
		image.position.set(ref.x + ref.width / 2, 0.5, ref.y + height / 2)
		image.renderOrder = 1
		root.add(image)
	}

	if (drawing.rooms.length > 0) {
		const roomFill = see(colors.room, 0.1)
		roomFill.polygonOffset = true
		roomFill.polygonOffsetFactor = -2
		roomFill.polygonOffsetUnits = -2
		const rooms = new Batch()
		for (const room of drawing.rooms) {
			rooms.add(roomFill, flat(room.points as Point[], 1))
		}
		for (const mesh of rooms.meshes(new Map())) {
			mesh.renderOrder = 2
			root.add(mesh)
		}
		const outline = new LineSegments(
			outlineSegments(
				drawing.rooms.map((room) => room.points as Point[]),
				1.5,
			),
			line(colors.room, 0.5),
		)
		root.add(outline)
	}

	// Walls between their openings; above each opening the wall closes again, below it the sill.
	drawing.walls.forEach((item, index: number) => {
		const openings = drawing.openings.filter((opening) => opening.wall === index)
		for (const piece of wallPieces(item, openings)) {
			batch.add(wall, prism(piece, 0, item.height))
		}
		for (const opening of openings) {
			const shape = openingShape(item, opening)
			// Kept within the wall, which may be lower than the opening reaches.
			const bottom = Math.min(opening.sill, item.height)
			const top = Math.min(opening.sill + opening.height, item.height)
			batch.add(wall, prism(shape.gap, 0, bottom))
			batch.add(wall, prism(shape.gap, top, item.height))
			if (shape.glass) {
				const [a, b] = shape.glass
				batch.add(glass, prism(strip(a, b, PANE, 0, distance(a, b)), bottom, top))
			}
			if (shape.leaf) {
				const [a, b] = shape.leaf
				batch.add(door, prism(strip(a, b, LEAF, 0, distance(a, b)), bottom, top - 1))
			}
			if (shape.panel) {
				batch.add(door, prism(shape.panel, bottom, top - 1))
			}
		}
	})

	// Stairs: one block per step, each a riser higher than the one before.
	for (const flight of drawing.stairs) {
		const steps = Math.max(1, Math.round(flight.steps))
		const depth = distance(flight.a, flight.b) / steps
		const rise = flight.rise / steps
		for (let i = 0; i < steps; i++) {
			batch.add(
				stair,
				prism(
					strip(flight.a, flight.b, flight.width, depth * i, depth * (i + 1)),
					0,
					rise * (i + 1),
				),
			)
		}
	}

	// Cable trays: runs reaching half their width past their ends, like on the plan.
	for (const run of drawing.trays) {
		const length = distance(run.a, run.b)
		batch.add(
			tray,
			prism(
				strip(run.a, run.b, run.width, -run.width / 2, length + run.width / 2),
				run.elevation,
				run.elevation + SIZES.tray,
			),
		)
	}

	/** A desk top on `outline`, `top` cm high, with legs inset from `corners`. */
	const deskWithLegs = (
		outline: Point[],
		corners: Point[],
		top: number,
		linked: boolean,
	): void => {
		const under = Math.max(0, top - SIZES.deskTop)
		batch.add(linked ? deskLinked : desk, prism(outline, under, top))
		const center = polygonCenter(outline)
		for (const corner of corners) {
			batch.add(pole, prism(square(toward(corner, center, LEG), LEG), 0, under))
		}
	}
	for (const item of drawing.desks) {
		const outline = deskOutline(item)
		deskWithLegs(outline, outline, item.height, item.location_id !== undefined)
	}
	for (const group of drawing.desk_groups) {
		for (const index of DESK_GROUP_DESKS) {
			deskWithLegs(
				deskGroupDesk(group, index),
				[],
				group.height,
				(group.location_ids[index] ?? null) !== null,
			)
		}
		// Legs under the center and the corners; screens on the dividers.
		for (const corner of deskGroupCorners(group)) {
			batch.add(
				pole,
				prism(
					square(toward(corner, group.center, LEG), LEG),
					0,
					Math.max(0, group.height - SIZES.deskTop),
				),
			)
		}
		for (const end of deskGroupArms(group)) {
			batch.add(
				screen,
				prism(
					strip(group.center, end, SCREEN, 0, distance(group.center, end)),
					group.height,
					group.height + SIZES.screen,
				),
			)
		}
	}

	// Stand-ins of the markers: a rack's cabinet, a pole under a device's or outlet's marker.
	for (const placement of drawing.placements) {
		const at: Point = [placement.x, placement.y]
		const base = placement.elevation
		if (placement.rack_id !== null) {
			batch.add(rack, prism(square(at, RACK_SIDE), base, base + rackHeight(placement)))
		} else {
			batch.add(pole, prism(square(at, 2), 0, base - 10))
		}
	}

	const occluders: Object3D[] = []
	for (const mesh of batch.meshes(edges)) {
		root.add(mesh)
		if (mesh instanceof Mesh && (mesh.material === wall || mesh.material === door)) {
			occluders.push(mesh)
		}
	}

	return {
		root,
		occluders,
		dispose: () => {
			root.traverse((object: Object3D) => {
				if (object instanceof Mesh || object instanceof LineSegments) {
					;(object.geometry as BufferGeometry).dispose()
				}
			})
			for (const material of materials) {
				material.dispose()
			}
			for (const texture of textures) {
				texture.dispose()
			}
		},
	}
}
