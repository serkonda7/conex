/**
 * Floors of a building, stacked: the plans of a location's child locations,
 * or of a site's top-level floors, share the building's frame through their
 * offsets (a sheet point `p` lies at `p + offset` in the building). A plan lists the
 * other floors of its building, may show one of them faded beneath its
 * drawing (the underlay, a view setting kept while the page is open, shared
 * by the view and the editor), and the editor may snap to it and offers the
 * stairs arriving from the floor directly below as ghosts to take over.
 */
import { IconMagnet, IconStack2 } from '@tabler/icons-solidjs'
import { type Accessor, createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import {
	type FloorplanDrawingJson,
	type FloorplanOffset,
	type FloorplanStackFloorJson,
	type FloorplanStair,
	fetch_drawing,
	fetch_drawing_stack,
} from '../api/floorplan_drawings'
import { t } from '../i18n'
import { createRecord, createRowsFor, type ErrorSink, type QueryReturn } from '../lib/resource'
import { readStored, writeStored } from '../lib/storage'
import {
	type Point,
	pillarCorners,
	pillarEdges,
	stairShape,
	wallFaceTargets,
} from './drawn_plan_geometry'
import { ringEdges, type SnapTargets } from './drawn_plan_snap'
import {
	drawingWalls,
	PillarLayer,
	RoomLayer,
	type Sheet,
	StairGlyph,
	StairLayer,
	stageItems,
	WallLayer,
} from './drawn_plan_stage'

/** How far ends of stairs may lie apart and still be the same stairs, cm. */
const SAME_STAIR_CM = 1

const SNAP_STORAGE_KEY = 'conex:drawn-plan-snap-underlay'

const [underlaySnap, setUnderlaySnap] = createSignal(readStored(SNAP_STORAGE_KEY) !== 'false')

/** Whether the editor also snaps to the floor beneath (on by default, kept per browser). */
export function underlaySnapEnabled(): boolean {
	return underlaySnap()
}

function toggleUnderlaySnap(): void {
	const next = !underlaySnap()
	setUnderlaySnap(next)
	writeStored(SNAP_STORAGE_KEY, String(next))
}

/** What to add to a point of the floor at `other` to get the same building point on the floor at `own`. */
export function floorShift(own: FloorplanOffset, other: FloorplanOffset): Point {
	return [other.x - own.x, other.y - own.y]
}

/** A floor as the pickers name it: its storey, if any, and its location. */
export function floorLabel(floor: { level: number | null; owner_name: string }): string {
	return floor.level === null
		? floor.owner_name
		: t('drawnPlan.floorOption', { level: floor.level, name: floor.owner_name })
}

/** The nearest floor below `level` of `floors` (lowest first); none without a storey. */
export function floorBelow(
	floors: FloorplanStackFloorJson[],
	level: number | null,
): FloorplanStackFloorJson | undefined {
	return level === null
		? undefined
		: floors
				.filter(
					(floor: FloorplanStackFloorJson) => floor.level !== null && floor.level < level,
				)
				.at(-1)
}

/** The other floors of a plan's building and the one shown beneath it. */
export interface FloorStack {
	floors: Accessor<FloorplanStackFloorJson[]>
	/** The floor chosen as the underlay, while it is still one of `floors`. */
	underlay: Accessor<FloorplanStackFloorJson | undefined>
	/** The underlay's plan, once loaded. */
	underlayDrawing: Accessor<FloorplanDrawingJson | null>
	setUnderlay: (id: number | null) => void
}

/** The stack of `drawing`'s building; loads nothing for a plan without one. */
export function createFloorStack(
	drawing: Accessor<FloorplanDrawingJson>,
	onError: ErrorSink,
): FloorStack {
	const [rows] = createRowsFor(
		() => (drawing().building === null ? null : drawing().id),
		fetch_drawing_stack,
		onError,
	)
	const floors = (): FloorplanStackFloorJson[] => rows() ?? []
	const [chosen, setChosen] = createSignal<number | null>(null)
	const underlay = createMemo(() =>
		floors().find((floor: FloorplanStackFloorJson) => floor.id === chosen()),
	)
	const [underlayDrawing] = createFloorDrawing(() => underlay()?.id, onError)
	return {
		floors,
		underlay,
		underlayDrawing: () => (underlay() ? (underlayDrawing() ?? null) : null),
		setUnderlay: setChosen,
	}
}

/** Another floor's plan by id; nothing loads while `id` is missing. */
export function createFloorDrawing(
	id: Accessor<number | undefined>,
	onError: ErrorSink,
): QueryReturn<FloorplanDrawingJson | null> {
	return createRecord(id, fetch_drawing, onError)
}

/** The underlay picker of the stage bar; hidden while the building has no other floor. */
export function UnderlayPicker(props: { stack: FloorStack }): JSX.Element {
	return (
		<Show when={props.stack.floors().length > 0}>
			<label class="floorplan-grid-size" title={t('drawnPlan.underlayHint')}>
				<IconStack2 size={12} aria-hidden="true" />
				<span>{t('drawnPlan.underlay')}</span>
				<select
					value={String(props.stack.underlay()?.id ?? '')}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) => {
						const raw = e.currentTarget.value
						props.stack.setUnderlay(raw === '' ? null : Number(raw))
					}}
				>
					<option value="">{t('drawnPlan.noUnderlay')}</option>
					<For each={props.stack.floors()}>
						{(floor: FloorplanStackFloorJson) => (
							<option value={String(floor.id)}>{floorLabel(floor)}</option>
						)}
					</For>
				</select>
			</label>
		</Show>
	)
}

/** The editor's toggle for snapping to the floor beneath; shown while one is. */
export function UnderlaySnapToggle(props: { stack: FloorStack }): JSX.Element {
	return (
		<Show when={props.stack.underlay()}>
			<button
				type="button"
				class="floorplan-layer-toggle floorplan-names-toggle"
				aria-pressed={underlaySnap()}
				title={t('drawnPlan.snapUnderlayHint')}
				onClick={toggleUnderlaySnap}
			>
				<IconMagnet size={12} aria-hidden="true" />
				<span>{t('drawnPlan.snapUnderlay')}</span>
			</button>
		</Show>
	)
}

/** What the floor beneath offers to snap to, moved into this floor's sheet (`offset`). */
export interface UnderlayTargets {
	/** For walls: the walls' ends and center lines (reaching half their thickness). */
	walls: SnapTargets
	/** For everything else: the walls' faces and corners, the pillars, and the stairs' and rooms' outlines. */
	objects: SnapTargets
}

export function underlayTargets(
	drawing: FloorplanDrawingJson,
	offset: FloorplanOffset,
): UnderlayTargets {
	const [dx, dy] = floorShift(offset, drawing.offset)
	const move = (p: Point): Point => [p[0] + dx, p[1] + dy]
	const walls = drawing.walls.map((wall) => ({ ...wall, a: move(wall.a), b: move(wall.b) }))
	const faces = wallFaceTargets(walls)
	const outlines = [
		...drawing.stairs.map(
			(stair: FloorplanStair) =>
				stairShape({ ...stair, a: move(stair.a), b: move(stair.b) }).outline,
		),
		...drawing.rooms.map((room) => room.points.map(move)),
	]
	const pillars = drawing.pillars.map((pillar) => ({ ...pillar, center: move(pillar.center) }))
	return {
		walls: {
			points: walls.flatMap((wall) => [wall.a, wall.b]),
			lines: walls.map((wall) => ({ a: wall.a, b: wall.b, reach: wall.thickness / 2 })),
			boxes: [],
		},
		objects: {
			points: [...faces.points, ...outlines.flat(), ...pillars.flatMap(pillarCorners)],
			lines: [
				...faces.faces.map(([a, b]) => ({ a, b, reach: 0 })),
				...outlines.flatMap((outline) =>
					ringEdges(outline).map(([a, b]) => ({ a, b, reach: 0 })),
				),
				...pillars.flatMap(pillarEdges).map(([a, b]) => ({ a, b, reach: 0 })),
			],
			boxes: [],
		},
	}
}

/** `targets` with `extra` added, if any. */
export function withTargets(targets: SnapTargets, extra: SnapTargets | undefined): SnapTargets {
	return extra
		? {
				points: [...targets.points, ...extra.points],
				lines: [...targets.lines, ...extra.lines],
				boxes: [...targets.boxes, ...extra.boxes],
			}
		: targets
}

/** Rooms, stairs, walls and pillars of another floor, inert, moved into this floor's sheet (`offset`). */
export function UnderlayLayer(props: {
	drawing: FloorplanDrawingJson
	offset: FloorplanOffset
}): JSX.Element {
	const shift = (): Point => floorShift(props.offset, props.drawing.offset)
	return (
		<g class="drawn-plan-underlay" transform={`translate(${shift()[0]} ${shift()[1]})`}>
			<RoomLayer rooms={stageItems('underlay-room', props.drawing.rooms)} />
			<StairLayer
				stairs={props.drawing.stairs.map((stair: FloorplanStair, i: number) => ({
					key: `underlay-stair:${i}`,
					stair,
				}))}
			/>
			<WallLayer walls={drawingWalls(props.drawing)} />
			<PillarLayer pillars={stageItems('underlay-pillar', props.drawing.pillars)} />
		</g>
	)
}

function samePoint(a: Point, b: Point): boolean {
	return Math.hypot(a[0] - b[0], a[1] - b[1]) <= SAME_STAIR_CM
}

/**
 * Stairs of the floor below (`below`) that arrive on this floor: moved into
 * this sheet (`offset`), lying on it, and not drawn here yet (no stairs with
 * the same ends).
 */
export function arrivingStairs(
	below: FloorplanDrawingJson,
	offset: FloorplanOffset,
	sheet: Sheet,
	drawn: Pick<FloorplanStair, 'a' | 'b'>[],
): FloorplanStair[] {
	const [dx, dy] = floorShift(offset, below.offset)
	const onSheet = (p: Point): boolean =>
		p[0] >= 0 && p[1] >= 0 && p[0] <= sheet.width && p[1] <= sheet.height
	return below.stairs.flatMap((stair: FloorplanStair) => {
		const a: Point = [stair.a[0] + dx, stair.a[1] + dy]
		const b: Point = [stair.b[0] + dx, stair.b[1] + dy]
		const known = drawn.some(
			(other: Pick<FloorplanStair, 'a' | 'b'>) =>
				samePoint(other.a, a) && samePoint(other.b, b),
		)
		return onSheet(a) && onSheet(b) && !known ? [{ ...stair, a, b }] : []
	})
}

/** Stairs arriving from the floor below, dashed; pressing one takes it over. */
export function GhostStairLayer(props: {
	stairs: FloorplanStair[]
	on_adopt: (stair: FloorplanStair) => void
}): JSX.Element {
	return (
		<For each={props.stairs}>
			{(stair: FloorplanStair) => (
				<g
					class="drawn-plan-stairs drawn-plan-stair-ghost"
					onPointerDown={(e: PointerEvent) => {
						e.preventDefault()
						e.stopPropagation()
						props.on_adopt(stair)
					}}
				>
					<title>{t('drawnPlan.adoptStairs')}</title>
					<StairGlyph shape={stairShape(stair)} />
				</g>
			)}
		</For>
	)
}
