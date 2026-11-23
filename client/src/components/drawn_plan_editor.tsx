/**
 * Edit mode of a drawn floor plan. Works on a draft copy and sends it with
 * one `PUT` on save; cancel discards it.
 *
 * - Select (default): click a wall, door, window, stairs, cable tray, desk,
 *   desk group, room (by its outline or label) or marker to select it, drag
 *   it to move it. A selected wall, flight of stairs, tray or desk shows
 *   handles on its ends, a room on its corners, a desk group on its divider
 *   ends (drag to rotate); walls (and trays) joined at a moved end follow
 *   it. The inspector below the stage edits the selection (length,
 *   thickness, width, swing, steps, depth, rotation, linked locations,
 *   label) and deletes it.
 * - Wall / cable tray: each click adds a corner, chaining runs; clicking the
 *   chain's first corner closes it, a double click, Enter or Escape ends it.
 * - Door / sliding door / window: a click on a wall puts one there.
 * - Stairs / desk: a click at one end, then one at the other (a desk's back
 *   edge; the desk lies to the left of it, "Flip side" turns it over).
 * - Desk group: a click puts three desks around a divider there, at the
 *   rotation and size set beside the stage.
 * - Room: each click adds a corner; clicking the first corner, a double
 *   click or Enter closes it, Escape drops it.
 * - Snap (toggle; Alt skips it): wall corners snap to wall ends, then onto
 *   walls; desk, desk group, room and tray corners to the walls' faces and
 *   to each other; otherwise to 10 cm steps. Lines from a previous point keep
 *   multiples of 15°; Shift frees the angle.
 * - Reference image: one of the owner's images (or a new upload) under the
 *   drawing, moved by dragging and scaled by two points a known distance
 *   apart.
 * - Markers: the palette's racks, devices and outlets are dragged onto the
 *   sheet or clicked to place them in the center, like on image plans.
 * - Undo / redo (Ctrl + Z, Ctrl + Shift + Z or Ctrl + Y, and the buttons).
 */
import {
	IconArrowBackUp,
	IconArrowForwardUp,
	IconArrowsHorizontal,
	IconDesk,
	IconDoor,
	IconMagnet,
	IconPhotoUp,
	IconPolygon,
	IconRoute,
	IconRulerMeasure,
	IconStairsUp,
	IconTopologyStar3,
	IconWall,
	IconWindow,
	IconX,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import {
	deskGroupFrontHalf,
	MAX_DESK_DEPTH,
	MAX_DESK_GROUP_ARM,
	MAX_DESK_GROUP_DEPTH,
	MAX_DRAWING_CM,
	MAX_OPENING_WIDTH,
	MAX_ROOM_POINTS,
	MAX_STAIR_STEPS,
	MAX_STAIR_WIDTH,
	MAX_TRAY_WIDTH,
	MAX_WALL_THICKNESS,
	MIN_DESK_DEPTH,
	MIN_DESK_GROUP_ARM,
	MIN_OPENING_WIDTH,
	MIN_STAIR_STEPS,
	MIN_STAIR_WIDTH,
	MIN_TRAY_WIDTH,
	MIN_WALL_THICKNESS,
	type OpeningKind,
} from 'shared/src/schemas'
import {
	createMemo,
	createSignal,
	For,
	type JSX,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import {
	type AttachmentJson,
	type AttachmentOwner,
	type FloorplanCandidateJson,
	type FloorplanPlacementJson,
	fetch_attachments,
	upload_attachment,
} from '../api/attachments'
import {
	type FloorplanDesk,
	type FloorplanDeskGroup,
	type FloorplanDrawingJson,
	type FloorplanDrawingPut,
	type FloorplanLinkLocationJson,
	type FloorplanOpening,
	type FloorplanRoom,
	type FloorplanStair,
	type FloorplanTray,
	type FloorplanWall,
	fetch_drawing_candidates,
	fetch_drawing_locations,
	put_drawing,
} from '../api/floorplan_drawings'
import { type MessageKey, t } from '../i18n'
import { locationTypeLabel } from '../i18n/labels'
import { createRows, createRowsFor, useAction } from '../lib/resource'
import { useLeaveGuard } from '../lib/router'
import { readStored, writeStored } from '../lib/storage'
import {
	ANGLE_STEP,
	along,
	clampPoint,
	constrainAngle,
	contentExtent,
	DEFAULT_DESK_DEPTH,
	DEFAULT_DESK_GROUP,
	DEFAULT_OPENING_WIDTH,
	DEFAULT_STAIR_WIDTH,
	DEFAULT_TRAY_WIDTH,
	DEFAULT_WALL_THICKNESS,
	DESK_GROUP_DESKS,
	type DeskGroupShape,
	defaultSteps,
	deskGroupArms,
	deskGroupCorners,
	deskGroupDesk,
	deskGroupEdges,
	deskOutline,
	direction,
	distance,
	lineHitsSegment,
	openingShape,
	openingSpan,
	type Point,
	polygonCenter,
	projectOnSegment,
	roundTo,
	samePoint,
	stairShape,
	wallFaceTargets,
	wallLength,
} from './drawn_plan_geometry'
import {
	DeskGroupLayer,
	DeskLayer,
	type DeskSeat,
	DrawnPlanStage,
	deskSeats,
	formatLength,
	locationNames,
	OpeningGlyph,
	percentOf,
	pxPerCm,
	RoomLayer,
	referenceOpacity,
	type Sheet,
	type StageItem,
	type StageReference,
	type StageStair,
	type StageWall,
	StairGlyph,
	StairLayer,
	setReferenceOpacity,
	svgPoints,
	TrayLayer,
	WallLayer,
} from './drawn_plan_stage'
import { InlineError } from './feedback'
import { ScaleDistanceDialog } from './floorplan_editor'
import { candidateKey, Palette } from './floorplan_palette'
import { snapEnabled, toggleSnap } from './floorplan_snap'
import { MarkerGlyph, MarkerName, markerClasses, markerTitle } from './floorplan_stage'
import { IconLabel } from './icon_label'
import type { StageZoom } from './zoom_viewport'

/** Snap range on screen, px. */
const SNAP_PX = 10

/** Snap step of points, lengths and moves, cm, whatever the grid size. */
const SNAP_STEP = 10

/** Shortest wall kept, cm. */
const MIN_WALL = 1

/** Undo steps kept. */
const MAX_UNDO = 100

/** Grid steps to choose from, cm. */
const GRID_STEPS = [25, 50, 100, 500, 1000] as const
type GridStep = (typeof GRID_STEPS)[number]
const DEFAULT_GRID_STEP: GridStep = 25
const GRID_STORAGE_KEY = 'conex:drawn-plan-grid'

function loadGridStep(): GridStep {
	const stored = Number(readStored(GRID_STORAGE_KEY))
	return GRID_STEPS.find((step) => step === stored) ?? DEFAULT_GRID_STEP
}

const [gridStep, setGridStepSignal] = createSignal<GridStep>(loadGridStep())

function setGridStep(step: GridStep): void {
	setGridStepSignal(step)
	writeStored(GRID_STORAGE_KEY, String(step))
}

interface EditWall extends FloorplanWall {
	id: number
}

interface EditOpening extends Omit<FloorplanOpening, 'wall'> {
	id: number
	wall_id: number
}

interface EditStair extends FloorplanStair {
	id: number
}

interface EditTray extends FloorplanTray {
	id: number
}

interface EditDesk extends FloorplanDesk {
	id: number
}

interface EditDeskGroup extends FloorplanDeskGroup {
	id: number
}

interface EditRoom extends FloorplanRoom {
	id: number
}

/** Size and rotation of the next desk group the tool puts down. */
type NewDeskGroup = Omit<DeskGroupShape, 'center'>

/** Deepest front curve that fits a desk group, cm. */
function maxCurve(group: Pick<DeskGroupShape, 'arm' | 'depth'>): number {
	return Math.max(
		0,
		Math.floor(
			Math.min(deskGroupFrontHalf(group.arm, group.depth), group.depth - group.arm / 2) * 100,
		) / 100,
	)
}

/** Shallowest and deepest a desk group with dividers `arm` long can be, cm. */
function depthRange(arm: number): { min: number; max: number } {
	return {
		min: Math.max(MIN_DESK_DEPTH, Math.floor(arm / 2) + 1),
		max: Math.min(MAX_DESK_GROUP_DEPTH, Math.ceil(arm * 2) - 1),
	}
}

/** Shortest and longest dividers a desk group `depth` deep can have, cm. */
function armRange(depth: number): { min: number; max: number } {
	return {
		min: Math.max(MIN_DESK_GROUP_ARM, Math.floor(depth / 2) + 1),
		max: Math.min(MAX_DESK_GROUP_ARM, Math.ceil(depth * 2) - 1),
	}
}

/** `group` with `patch`, its front curve cut down to what still fits. */
function resized<T extends NewDeskGroup>(group: T, patch: Partial<NewDeskGroup>): T {
	const next = { ...group, ...patch }
	return { ...next, curve: Math.min(next.curve, maxCurve(next)) }
}

/** An angle in degrees within 0–360. */
function normalDegrees(degrees: number): number {
	const value = ((degrees % 360) + 360) % 360
	return round2(value) === 360 ? 0 : value
}

/** Anything with an id and two ends that chains at shared ends: walls and trays. */
interface Run {
	id: number
	a: Point
	b: Point
}

/** Ends of `runs` lying at `point`, as (run, end) pairs. */
function runEndsAt(runs: Run[], point: Point): { id: number; end: 'a' | 'b' }[] {
	return runs.flatMap((run: Run) => [
		...(samePoint(run.a, point) ? [{ id: run.id, end: 'a' as const }] : []),
		...(samePoint(run.b, point) ? [{ id: run.id, end: 'b' as const }] : []),
	])
}

/** `runs` with the given ends moved to `to`. */
function movedRunEnds<T extends Run>(
	runs: T[],
	ends: { id: number; end: 'a' | 'b' }[],
	to: Point,
): T[] {
	return runs.map((run: T) => {
		const moved = ends.filter((entry) => entry.id === run.id)
		if (moved.length === 0) {
			return run
		}
		const next = { ...run }
		for (const entry of moved) {
			next[entry.end] = to
		}
		return next
	})
}

/** What a point being placed may snap to. */
interface SnapTargets {
	/** Points it jumps onto within the snap range. */
	points: Point[]
	/** Lines it lands on within `reach` (cm) or the snap range. */
	lines: { a: Point; b: Point; reach: number }[]
}

type Tool =
	| 'select'
	| 'wall'
	| OpeningKind
	| 'stairs'
	| 'tray'
	| 'desk'
	| 'deskGroup'
	| 'room'
	| 'image'
	| 'calibrate'

function isOpeningKind(value: unknown): value is OpeningKind {
	return value === 'door' || value === 'sliding_door' || value === 'window'
}

/** Palette label, delete label and icon of each kind of opening. */
const OPENING_UI: Record<
	OpeningKind,
	{ tool: MessageKey; name: MessageKey; remove: MessageKey; icon: typeof IconDoor }
> = {
	door: {
		tool: 'drawnPlan.toolDoor',
		name: 'drawnPlan.door',
		remove: 'drawnPlan.deleteDoor',
		icon: IconDoor,
	},
	sliding_door: {
		tool: 'drawnPlan.toolSlidingDoor',
		name: 'drawnPlan.slidingDoor',
		remove: 'drawnPlan.deleteSlidingDoor',
		icon: IconArrowsHorizontal,
	},
	window: {
		tool: 'drawnPlan.toolWindow',
		name: 'drawnPlan.window',
		remove: 'drawnPlan.deleteWindow',
		icon: IconWindow,
	},
}

/** Palette entries of the elements drawn by clicking their outline. */
interface ElementTool {
	tool: 'tray' | 'desk' | 'deskGroup' | 'room'
	icon: typeof IconDoor
	label: MessageKey
	hint: MessageKey
}

const ELEMENT_TOOLS: ElementTool[] = [
	{ tool: 'tray', icon: IconRoute, label: 'drawnPlan.toolTray', hint: 'drawnPlan.trayHint' },
	{ tool: 'desk', icon: IconDesk, label: 'drawnPlan.toolDesk', hint: 'drawnPlan.deskHint' },
	{
		tool: 'deskGroup',
		icon: IconTopologyStar3,
		label: 'drawnPlan.toolDeskGroup',
		hint: 'drawnPlan.deskGroupHint',
	},
	{ tool: 'room', icon: IconPolygon, label: 'drawnPlan.toolRoom', hint: 'drawnPlan.roomHint' },
]

/** Tabs of the side panel: drawing elements, adding objects, and the plan's sheet and image. */
type SideTab = 'draw' | 'add' | 'plan'

type SelectedKind = 'wall' | 'opening' | 'stair' | 'tray' | 'desk' | 'deskGroup' | 'room' | 'marker'

interface Selected {
	kind: SelectedKind
	id: number
}

/** The draft's editable state, as one undo step restores it. */
interface Snapshot {
	sheet: Sheet
	reference: StageReference | null
	walls: EditWall[]
	openings: EditOpening[]
	stairs: EditStair[]
	trays: EditTray[]
	desks: EditDesk[]
	deskGroups: EditDeskGroup[]
	rooms: EditRoom[]
	placements: FloorplanPlacementJson[]
}

/** True while focus is in a text field, which keeps its own keys (undo, Delete). */
function typingIn(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	)
}

function round2(value: number): number {
	return Math.round(value * 100) / 100
}

function roundPoint(p: Point): Point {
	return [round2(p[0]), round2(p[1])]
}

function keyOf(selected: Selected): string {
	return `${selected.kind}:${selected.id}`
}

/** The wire form of a draft; also what "changed" is measured on. */
function toPut(state: Snapshot): FloorplanDrawingPut {
	const walls = state.walls.filter((wall: EditWall) => wallLength(wall) >= MIN_WALL)
	const index = new Map(walls.map((wall: EditWall, i: number) => [wall.id, i]))
	return {
		width: round2(state.sheet.width),
		height: round2(state.sheet.height),
		reference: state.reference
			? {
					attachment_id: state.reference.attachment.id,
					x: round2(state.reference.x),
					y: round2(state.reference.y),
					width: round2(state.reference.width),
				}
			: null,
		walls: walls.map((wall: EditWall) => ({
			a: roundPoint(wall.a),
			b: roundPoint(wall.b),
			thickness: round2(wall.thickness),
		})),
		openings: state.openings.flatMap((opening: EditOpening) => {
			const wallIndex = index.get(opening.wall_id)
			const wall = wallIndex === undefined ? undefined : walls[wallIndex]
			if (wallIndex === undefined || !wall || wallLength(wall) < MIN_OPENING_WIDTH) {
				return []
			}
			const [from, to] = openingSpan(wall, { ...opening, wall: wallIndex })
			return [
				{
					wall: wallIndex,
					kind: opening.kind,
					offset: round2((from + to) / 2),
					width: Math.max(MIN_OPENING_WIDTH, Math.floor((to - from) * 100) / 100),
					hinge: opening.hinge,
					side: opening.side,
				},
			]
		}),
		stairs: state.stairs
			.filter((stair: EditStair) => distance(stair.a, stair.b) >= MIN_WALL)
			.map((stair: EditStair) => ({
				a: roundPoint(stair.a),
				b: roundPoint(stair.b),
				width: round2(stair.width),
				steps: stair.steps,
			})),
		trays: state.trays
			.filter((tray: EditTray) => distance(tray.a, tray.b) >= MIN_WALL)
			.map((tray: EditTray) => ({
				a: roundPoint(tray.a),
				b: roundPoint(tray.b),
				width: round2(tray.width),
			})),
		desks: state.desks
			.filter((desk: EditDesk) => distance(desk.a, desk.b) >= MIN_WALL)
			.map((desk: EditDesk) => ({
				a: roundPoint(desk.a),
				b: roundPoint(desk.b),
				depth: round2(desk.depth),
				...(desk.location_id === undefined ? {} : { location_id: desk.location_id }),
			})),
		desk_groups: state.deskGroups.map((group: EditDeskGroup) => {
			const arm = round2(group.arm)
			const depth = round2(group.depth)
			return {
				center: roundPoint(group.center),
				rotation: round2(normalDegrees(group.rotation)),
				arm,
				depth,
				curve: Math.min(round2(group.curve), maxCurve({ arm, depth })),
				location_ids: group.location_ids,
			}
		}),
		rooms: state.rooms.map((room: EditRoom) => ({
			points: room.points.map(roundPoint),
			...(room.location_id === undefined ? {} : { location_id: room.location_id }),
			...(room.label ? { label: room.label } : {}),
		})),
		placements: state.placements.map((placement: FloorplanPlacementJson) => ({
			...(placement.rack_id !== null
				? { rack_id: placement.rack_id }
				: placement.jack_id !== null
					? { jack_id: placement.jack_id }
					: placement.interface_id !== null
						? { interface_id: placement.interface_id }
						: { device_id: placement.device_id ?? undefined }),
			x: round2(placement.x),
			y: round2(placement.y),
		})),
	}
}

/** A number field of the inspector or side panel that commits on change. */
function NumberField(props: {
	label: string
	value: number
	min: number
	max: number
	step?: number
	on_commit: (value: number) => void
}): JSX.Element {
	return (
		<label>
			<span>{props.label}</span>
			<input
				type="number"
				class="drawn-plan-control"
				value={String(round2(props.value))}
				min={props.min}
				max={props.max}
				step={props.step ?? 1}
				onChange={(e: Event & { currentTarget: HTMLInputElement }) => {
					const value = Number(e.currentTarget.value)
					if (Number.isFinite(value) && value >= props.min && value <= props.max) {
						props.on_commit(value)
					} else {
						e.currentTarget.value = String(round2(props.value))
					}
				}}
			/>
		</label>
	)
}

/** Rotation, divider length, depth and front curve of a desk group, each bounded by the others. */
function DeskGroupFields(props: {
	group: NewDeskGroup
	on_commit: (patch: Partial<NewDeskGroup>) => void
}): JSX.Element {
	return (
		<>
			<NumberField
				label={t('drawnPlan.rotation')}
				value={props.group.rotation}
				min={0}
				max={360}
				on_commit={(rotation: number) =>
					props.on_commit({ rotation: normalDegrees(rotation) })
				}
			/>
			<NumberField
				label={t('drawnPlan.dividerLength')}
				value={props.group.arm}
				min={armRange(props.group.depth).min}
				max={armRange(props.group.depth).max}
				on_commit={(arm: number) => props.on_commit({ arm })}
			/>
			<NumberField
				label={t('drawnPlan.groupDepth')}
				value={props.group.depth}
				min={depthRange(props.group.arm).min}
				max={depthRange(props.group.arm).max}
				on_commit={(depth: number) => props.on_commit({ depth })}
			/>
			<NumberField
				label={t('drawnPlan.frontCurve')}
				value={props.group.curve}
				min={0}
				max={maxCurve(props.group)}
				on_commit={(curve: number) => props.on_commit({ curve })}
			/>
		</>
	)
}

/** A text field of the inspector that commits on change. */
function TextField(props: {
	label: string
	value: string
	placeholder?: string
	max: number
	on_commit: (value: string) => void
}): JSX.Element {
	return (
		<label>
			<span>{props.label}</span>
			<input
				type="text"
				class="drawn-plan-control"
				value={props.value}
				placeholder={props.placeholder}
				maxLength={props.max}
				onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
					props.on_commit(e.currentTarget.value.trim())
				}
			/>
		</label>
	)
}

/** The location a desk or room links to, picked from the owner's locations. */
function LocationField(props: {
	/** Field label; "Location" without one. */
	label?: string
	value: number | undefined
	locations: FloorplanLinkLocationJson[]
	/** Names of linked locations missing from `locations` (hidden or deleted). */
	known: Map<number, string>
	on_commit: (value: number | undefined) => void
}): JSX.Element {
	const missing = (): number | undefined =>
		props.value !== undefined &&
		!props.locations.some((location: FloorplanLinkLocationJson) => location.id === props.value)
			? props.value
			: undefined
	return (
		<label>
			<span>{props.label ?? t('drawnPlan.location')}</span>
			<select
				class="drawn-plan-control"
				value={String(props.value ?? '')}
				onChange={(e: Event & { currentTarget: HTMLSelectElement }) => {
					const raw = e.currentTarget.value
					props.on_commit(raw === '' ? undefined : Number(raw))
				}}
			>
				<option value="">{t('drawnPlan.noLocation')}</option>
				<Show when={missing()}>
					{(id: () => number) => (
						<option value={String(id())}>
							{props.known.get(id()) ?? t('drawnPlan.unknownLocation', { id: id() })}
						</option>
					)}
				</Show>
				<For each={props.locations}>
					{(location: FloorplanLinkLocationJson) => (
						<option value={String(location.id)}>
							{t('drawnPlan.locationOption', {
								name: location.name,
								type: locationTypeLabel(location.type),
							})}
						</option>
					)}
				</For>
			</select>
		</label>
	)
}

export function DrawnPlanEditor(props: {
	drawing: FloorplanDrawingJson
	zoom: StageZoom
	on_saved: (drawing: FloorplanDrawingJson) => void
	on_cancel: () => void
	/** Page header slot the Cancel / Save buttons render into, in place of Edit. */
	actions_mount: HTMLElement | undefined
}): JSX.Element {
	const zoom = props.zoom
	const [error, setError] = createSignal<string | null>(null)
	// Items added in the editor get negative ids, which never clash.
	let nextId = -1
	const freshId = (): number => nextId--

	const initialWalls: EditWall[] = props.drawing.walls.map((wall: FloorplanWall, i: number) => ({
		...wall,
		id: i + 1,
	}))
	const [sheet, setSheet] = createSignal<Sheet>({
		width: props.drawing.width,
		height: props.drawing.height,
	})
	const [reference, setReference] = createSignal<StageReference | null>(props.drawing.reference)
	const [walls, setWalls] = createSignal<EditWall[]>(initialWalls)
	const [openings, setOpenings] = createSignal<EditOpening[]>(
		props.drawing.openings.map(({ wall, ...opening }: FloorplanOpening, i: number) => ({
			...opening,
			id: i + 1,
			wall_id: wall + 1,
		})),
	)
	const [stairs, setStairs] = createSignal<EditStair[]>(
		props.drawing.stairs.map((stair: FloorplanStair, i: number) => ({ ...stair, id: i + 1 })),
	)
	const [trays, setTrays] = createSignal<EditTray[]>(
		props.drawing.trays.map((tray: FloorplanTray, i: number) => ({ ...tray, id: i + 1 })),
	)
	const [desks, setDesks] = createSignal<EditDesk[]>(
		props.drawing.desks.map((desk: FloorplanDesk, i: number) => ({ ...desk, id: i + 1 })),
	)
	const [deskGroups, setDeskGroups] = createSignal<EditDeskGroup[]>(
		props.drawing.desk_groups.map((group: FloorplanDeskGroup, i: number) => ({
			...group,
			id: i + 1,
		})),
	)
	const [rooms, setRooms] = createSignal<EditRoom[]>(
		props.drawing.rooms.map((room: FloorplanRoom, i: number) => ({ ...room, id: i + 1 })),
	)
	const [placements, setPlacements] = createSignal<FloorplanPlacementJson[]>(
		props.drawing.placements,
	)
	const [selected, setSelected] = createSignal<Selected | null>(null)
	const [tool, setToolSignal] = createSignal<Tool>('select')
	const [thickness, setThickness] = createSignal(DEFAULT_WALL_THICKNESS)
	const [trayWidth, setTrayWidth] = createSignal(DEFAULT_TRAY_WIDTH)
	const [deskDepth, setDeskDepth] = createSignal(DEFAULT_DESK_DEPTH)
	const [newGroup, setNewGroup] = createSignal<NewDeskGroup>({
		rotation: 0,
		...DEFAULT_DESK_GROUP,
	})
	/** Corner the next wall or tray of a chain starts at, and the chain's first corner. */
	const [chain, setChain] = createSignal<{ first: Point; last: Point } | null>(null)
	/** First end of the stairs or desk being drawn. */
	const [lineStart, setLineStart] = createSignal<Point | null>(null)
	/** Corners of the room being drawn. */
	const [roomDraft, setRoomDraft] = createSignal<Point[] | null>(null)
	/** Pointer on the sheet (cm), snapped while a tool draws. */
	const [hover, setHover] = createSignal<Point | null>(null)
	const [pointer, setPointer] = createSignal<Point | null>(null)
	const [snapMark, setSnapMark] = createSignal<Point | null>(null)
	/** Scale points on the reference image: the first, then both while the distance is asked. */
	const [calibration, setCalibration] = createSignal<{ a: Point; b: Point | null } | null>(null)
	const [askDistance, setAskDistance] = createSignal(false)
	const [undoStack, setUndoStack] = createSignal<Snapshot[]>([])
	const [redoStack, setRedoStack] = createSignal<Snapshot[]>([])
	const [search, setSearch] = createSignal('')
	const [tab, setTab] = createSignal<SideTab>('draw')
	const [dragged, setDragged] = createSignal<string | null>(null)
	const [sequence, setSequence] = createSignal<number | null>(null)
	const [stage, setStage] = createSignal<HTMLDivElement>()
	const save = useAction(setError)
	const owner: AttachmentOwner =
		props.drawing.site_id !== null
			? { site_id: props.drawing.site_id }
			: { location_id: props.drawing.location_id ?? 0 }
	const [images, { refetch: refetchImages }] = createRowsFor(
		() => owner,
		fetch_attachments,
		setError,
	)
	const [candidates] = createRows(() => fetch_drawing_candidates(props.drawing.id), setError)
	const [linkLocations] = createRows(() => fetch_drawing_locations(props.drawing.id), setError)
	/** Names of every location a desk, desk group or room may show: those linked on load, then the candidates. */
	const knownLocations = createMemo(() =>
		locationNames([...props.drawing.linked_locations, ...(linkLocations() ?? [])]),
	)

	const snapshot = (): Snapshot => ({
		sheet: sheet(),
		reference: reference(),
		walls: walls(),
		openings: openings(),
		stairs: stairs(),
		trays: trays(),
		desks: desks(),
		deskGroups: deskGroups(),
		rooms: rooms(),
		placements: placements(),
	})
	const initial = JSON.stringify(toPut(snapshot()))
	const dirty = createMemo(() => JSON.stringify(toPut(snapshot())) !== initial)

	const placed = createMemo(
		() => new Set(placements().map((p: FloorplanPlacementJson) => candidateKey(p))),
	)

	/** Candidates not yet on the draft, for the Add tab's count. */
	const freeCount = createMemo(
		() =>
			(candidates() ?? []).filter(
				(item: FloorplanCandidateJson) => !placed().has(candidateKey(item)),
			).length,
	)

	const stageWalls = createMemo((): StageWall[] =>
		walls().map((wall: EditWall) => ({
			key: `wall:${wall.id}`,
			wall,
			openings: openings()
				.filter((opening: EditOpening) => opening.wall_id === wall.id)
				.map((opening: EditOpening) => ({
					key: `opening:${opening.id}`,
					opening: { ...opening, wall: 0 },
				})),
		})),
	)

	const selectedWall = createMemo(() => {
		const current = selected()
		return current?.kind === 'wall'
			? walls().find((wall: EditWall) => wall.id === current.id)
			: undefined
	})
	const selectedOpening = createMemo(() => {
		const current = selected()
		return current?.kind === 'opening'
			? openings().find((opening: EditOpening) => opening.id === current.id)
			: undefined
	})
	const stageStairs = createMemo((): StageStair[] =>
		stairs().map((stair: EditStair) => ({ key: `stair:${stair.id}`, stair })),
	)

	const selectedStair = createMemo(() => {
		const current = selected()
		return current?.kind === 'stair'
			? stairs().find((stair: EditStair) => stair.id === current.id)
			: undefined
	})
	const stageTrays = createMemo((): StageItem<EditTray>[] =>
		trays().map((tray: EditTray) => ({ key: `tray:${tray.id}`, item: tray })),
	)
	const stageDesks = createMemo((): StageItem<EditDesk>[] =>
		desks().map((desk: EditDesk) => ({ key: `desk:${desk.id}`, item: desk })),
	)
	const stageGroups = createMemo((): StageItem<EditDeskGroup>[] =>
		deskGroups().map((group: EditDeskGroup) => ({ key: `deskGroup:${group.id}`, item: group })),
	)
	/** Every desk, alone or of a group, for its location label. */
	const seats = createMemo((): DeskSeat[] => deskSeats(stageDesks(), stageGroups()))
	const stageRooms = createMemo((): StageItem<EditRoom>[] =>
		rooms().map((room: EditRoom) => ({ key: `room:${room.id}`, item: room })),
	)
	const selectedTray = createMemo(() => {
		const current = selected()
		return current?.kind === 'tray'
			? trays().find((tray: EditTray) => tray.id === current.id)
			: undefined
	})
	const selectedDesk = createMemo(() => {
		const current = selected()
		return current?.kind === 'desk'
			? desks().find((desk: EditDesk) => desk.id === current.id)
			: undefined
	})
	const selectedGroup = createMemo(() => {
		const current = selected()
		return current?.kind === 'deskGroup'
			? deskGroups().find((group: EditDeskGroup) => group.id === current.id)
			: undefined
	})
	const selectedRoom = createMemo(() => {
		const current = selected()
		return current?.kind === 'room'
			? rooms().find((room: EditRoom) => room.id === current.id)
			: undefined
	})
	const selectedMarker = createMemo(() => {
		const current = selected()
		return current?.kind === 'marker'
			? placements().find((p: FloorplanPlacementJson) => p.id === current.id)
			: undefined
	})

	// --- undo / redo -------------------------------------------------------

	/** Records the draft as it stands, before a change, as an undo step. */
	function checkpoint(): void {
		setUndoStack((stack: Snapshot[]) => [...stack, snapshot()].slice(-MAX_UNDO))
		setRedoStack([])
	}

	function restore(state: Snapshot): void {
		setSheet(state.sheet)
		setReference(state.reference)
		setWalls(state.walls)
		setOpenings(state.openings)
		setStairs(state.stairs)
		setTrays(state.trays)
		setDesks(state.desks)
		setDeskGroups(state.deskGroups)
		setRooms(state.rooms)
		setPlacements(state.placements)
		const current = selected()
		const exists =
			current === null ||
			(current.kind === 'tray' && state.trays.some((x: EditTray) => x.id === current.id)) ||
			(current.kind === 'desk' && state.desks.some((x: EditDesk) => x.id === current.id)) ||
			(current.kind === 'deskGroup' &&
				state.deskGroups.some((x: EditDeskGroup) => x.id === current.id)) ||
			(current.kind === 'room' && state.rooms.some((x: EditRoom) => x.id === current.id)) ||
			(current.kind === 'wall' && state.walls.some((w: EditWall) => w.id === current.id)) ||
			(current.kind === 'opening' &&
				state.openings.some((o: EditOpening) => o.id === current.id)) ||
			(current.kind === 'stair' &&
				state.stairs.some((s: EditStair) => s.id === current.id)) ||
			(current.kind === 'marker' &&
				state.placements.some((p: FloorplanPlacementJson) => p.id === current.id))
		if (!exists) {
			setSelected(null)
		}
	}

	function undo(): void {
		const stack = undoStack()
		const previous = stack[stack.length - 1]
		if (previous) {
			setRedoStack((all: Snapshot[]) => [...all, snapshot()])
			setUndoStack(stack.slice(0, -1))
			restore(previous)
		}
	}

	function redo(): void {
		const stack = redoStack()
		const next = stack[stack.length - 1]
		if (next) {
			setUndoStack((all: Snapshot[]) => [...all, snapshot()])
			setRedoStack(stack.slice(0, -1))
			restore(next)
		}
	}

	// --- pointer mapping and snapping ---------------------------------------

	/** Position of a pointer event on the sheet in cm, clamped to it. */
	function stagePoint(e: { clientX: number; clientY: number }): Point {
		const box = stage()?.getBoundingClientRect()
		if (!box || box.width === 0 || box.height === 0) {
			return [0, 0]
		}
		const { width, height } = sheet()
		return clampPoint(
			[
				((e.clientX - box.left) / box.width) * width,
				((e.clientY - box.top) / box.height) * height,
			],
			width,
			height,
		)
	}

	/** Snap range in cm at the current zoom. */
	function snapRange(): number {
		const px = pxPerCm(zoom, sheet())
		return px > 0 ? SNAP_PX / px : 0
	}

	function snapping(e: { altKey: boolean }): boolean {
		return snapEnabled() && !e.altKey
	}

	/** One coordinate snapped to the 10 cm step. */
	function snapAxis(value: number): number {
		return roundTo(value, SNAP_STEP)
	}

	/** A point snapped to the 10 cm step. */
	function snapPosition(p: Point): Point {
		return [snapAxis(p[0]), snapAxis(p[1])]
	}

	/** Wall ends and wall lines (reaching half their thickness), but not of the walls in `exclude`. */
	function wallTargets(exclude: Set<number> = new Set()): SnapTargets {
		const targets = walls().filter((wall: EditWall) => !exclude.has(wall.id))
		return {
			points: targets.flatMap((wall: EditWall) => [wall.a, wall.b]),
			lines: targets.map((wall: EditWall) => ({
				a: wall.a,
				b: wall.b,
				reach: wall.thickness / 2,
			})),
		}
	}

	const faces = createMemo(() => wallFaceTargets(walls()))

	/**
	 * The walls' faces and their corners, plus what a tray, desk or room
	 * lines up with: the trays' ends and lines (but not those in `exclude`),
	 * the other desks' and desk groups' corners and outer edges (not the desk
	 * in `exclude` or the group `excludeGroup` being edited), or the other
	 * rooms' corners and edges.
	 */
	function faceTargets(
		kind: 'tray' | 'desk' | 'room',
		exclude: Set<number>,
		excludeGroup: number | null = null,
	): SnapTargets {
		const { points, faces: lines } = faces()
		const edges = (corners: Point[]): { a: Point; b: Point; reach: number }[] =>
			corners.map((corner: Point, i: number) => ({
				a: corner,
				b: corners[(i + 1) % corners.length] as Point,
				reach: 0,
			}))
		const own: SnapTargets =
			kind === 'tray'
				? {
						points: trays()
							.filter((tray: EditTray) => !exclude.has(tray.id))
							.flatMap((tray: EditTray) => [tray.a, tray.b]),
						lines: trays()
							.filter((tray: EditTray) => !exclude.has(tray.id))
							.map((tray: EditTray) => ({
								a: tray.a,
								b: tray.b,
								reach: tray.width / 2,
							})),
					}
				: (() => {
						const shapes =
							kind === 'desk'
								? desks()
										.filter((desk: EditDesk) => !exclude.has(desk.id))
										.map((desk: EditDesk) => deskOutline(desk))
								: rooms()
										.filter((room: EditRoom) => !exclude.has(room.id))
										.map((room: EditRoom) => room.points)
						const groups =
							kind === 'desk'
								? deskGroups().filter(
										(group: EditDeskGroup) => group.id !== excludeGroup,
									)
								: []
						return {
							points: [...shapes.flat(), ...groups.flatMap(deskGroupCorners)],
							lines: [
								...shapes.flatMap(edges),
								...groups.flatMap((group: EditDeskGroup) =>
									deskGroupEdges(group).map(([a, b]) => ({ a, b, reach: 0 })),
								),
							],
						}
					})()
		return {
			points: [...own.points, ...points],
			lines: [...own.lines, ...lines.map(([a, b]) => ({ a, b, reach: 0 }))],
		}
	}

	/**
	 * A point at `raw` while snapping (Alt places it freely): a target point
	 * within range wins. From a previous point `from` the line keeps a
	 * multiple of 15° (Shift frees the angle) with a length in 10 cm steps,
	 * and ends on a target line it meets near the pointer. Otherwise the
	 * point lands on a target line, else on the 10 cm step. Marks the point
	 * snapped to.
	 */
	function snapTo(
		e: { altKey: boolean; shiftKey: boolean },
		raw: Point,
		from: Point | null,
		targets: SnapTargets,
	): Point {
		setSnapMark(null)
		const { width, height } = sheet()
		if (!snapping(e)) {
			return raw
		}
		const range = snapRange()
		let best: Point | null = null
		let bestDistance = range
		for (const point of targets.points) {
			const d = distance(raw, point)
			if (d <= bestDistance) {
				best = point
				bestDistance = d
			}
		}
		if (best) {
			setSnapMark(best)
			return best
		}
		if (from && !e.shiftKey) {
			const constrained = clampPoint(constrainAngle(from, raw, SNAP_STEP), width, height)
			for (const line of targets.lines) {
				const hit = lineHitsSegment(from, constrained, line.a, line.b)
				if (hit && distance(hit, constrained) <= Math.max(range, line.reach)) {
					setSnapMark(hit)
					return hit
				}
			}
			return constrained
		}
		for (const line of targets.lines) {
			const hit = projectOnSegment(raw, line.a, line.b)
			if (hit.distance <= Math.max(range, line.reach)) {
				setSnapMark(hit.point)
				return hit.point
			}
		}
		return clampPoint(snapPosition(raw), width, height)
	}

	/** A wall corner at `raw`: `snapTo` the walls other than those in `exclude`. */
	function snapCorner(
		e: { altKey: boolean; shiftKey: boolean },
		raw: Point,
		from: Point | null,
		exclude: Set<number> = new Set(),
	): Point {
		return snapTo(e, raw, from, wallTargets(exclude))
	}

	/**
	 * The move `delta` of a shape with `corners`, snapped while snapping: the
	 * corner nearest to a target point within range lands on it, else the
	 * first corner on the 10 cm step.
	 */
	function snapMove(
		e: { altKey: boolean },
		corners: Point[],
		delta: Point,
		targets: SnapTargets,
	): Point {
		setSnapMark(null)
		if (!snapping(e) || corners.length === 0) {
			return delta
		}
		let best: { delta: Point; distance: number; at: Point } | null = null
		const range = snapRange()
		for (const corner of corners) {
			const moved: Point = [corner[0] + delta[0], corner[1] + delta[1]]
			for (const point of targets.points) {
				const d = distance(moved, point)
				if (d <= range && (!best || d < best.distance)) {
					best = {
						delta: [point[0] - corner[0], point[1] - corner[1]],
						distance: d,
						at: point,
					}
				}
			}
		}
		if (best) {
			setSnapMark(best.at)
			return best.delta
		}
		const first = corners[0] as Point
		const snapped = snapPosition([first[0] + delta[0], first[1] + delta[1]])
		return [snapped[0] - first[0], snapped[1] - first[1]]
	}

	/** `delta` cut down so every point of `points` stays on the sheet. */
	function keepOnSheet(points: Point[], delta: Point): Point {
		const { width, height } = sheet()
		const xs = points.map((p: Point) => p[0])
		const ys = points.map((p: Point) => p[1])
		return [
			Math.min(width - Math.max(...xs), Math.max(-Math.min(...xs), delta[0])),
			Math.min(height - Math.max(...ys), Math.max(-Math.min(...ys), delta[1])),
		]
	}

	/** Nearest wall under `at` (within its thickness or the snap range), with the hit. */
	function wallAt(at: Point): { wall: EditWall; offset: number } | null {
		let best: { wall: EditWall; offset: number } | null = null
		let bestDistance = Number.POSITIVE_INFINITY
		for (const wall of walls()) {
			const hit = projectOnSegment(at, wall.a, wall.b)
			if (
				hit.distance <= Math.max(snapRange(), wall.thickness / 2) &&
				hit.distance < bestDistance
			) {
				best = { wall, offset: hit.offset }
				bestDistance = hit.distance
			}
		}
		return best
	}

	// --- drags --------------------------------------------------------------

	/**
	 * Starts a pointer drag: `move` gets the pointer on the sheet (cm) and the
	 * event until release. The first move records one undo step.
	 */
	function startEdit(
		e: PointerEvent,
		move: (at: Point, ev: PointerEvent) => void,
		end?: () => void,
	): void {
		e.preventDefault()
		e.stopPropagation()
		let recorded = false
		const onMove = (ev: PointerEvent): void => {
			if (!recorded) {
				recorded = true
				checkpoint()
			}
			move(stagePoint(ev), ev)
		}
		const onUp = (): void => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
			window.removeEventListener('pointercancel', onUp)
			setSnapMark(null)
			end?.()
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		window.addEventListener('pointercancel', onUp)
	}

	/** Wall ends lying at `point`, as (wall, end) pairs. */
	function jointAt(point: Point): { id: number; end: 'a' | 'b' }[] {
		return runEndsAt(walls(), point)
	}

	/** Moves the given wall ends to `to`. */
	function moveEnds(ends: { id: number; end: 'a' | 'b' }[], to: Point): void {
		setWalls((all: EditWall[]) => movedRunEnds(all, ends, to))
	}

	function dragEnd(e: PointerEvent, wall: EditWall, end: 'a' | 'b'): void {
		const ends = jointAt(wall[end])
		const exclude = new Set(ends.map((entry) => entry.id))
		const other = end === 'a' ? wall.b : wall.a
		startEdit(e, (at: Point, ev: PointerEvent) => {
			moveEnds(ends, snapCorner(ev, at, other, exclude))
		})
	}

	function pressWall(e: PointerEvent, key: string): void {
		const id = Number(key.split(':')[1])
		const wall = walls().find((w: EditWall) => w.id === id)
		if (!wall || tool() !== 'select') {
			return
		}
		setSelected({ kind: 'wall', id })
		const startA = wall.a
		const startB = wall.b
		const endsA = jointAt(startA)
		const endsB = jointAt(startB)
		const from = stagePoint(e)
		const { width, height } = sheet()
		startEdit(e, (at: Point, ev: PointerEvent) => {
			let dx = at[0] - from[0]
			let dy = at[1] - from[1]
			if (snapping(ev)) {
				const snapped = snapPosition([startA[0] + dx, startA[1] + dy])
				dx = snapped[0] - startA[0]
				dy = snapped[1] - startA[1]
			}
			// Keep both ends on the sheet.
			dx = Math.min(
				width - Math.max(startA[0], startB[0]),
				Math.max(-Math.min(startA[0], startB[0]), dx),
			)
			dy = Math.min(
				height - Math.max(startA[1], startB[1]),
				Math.max(-Math.min(startA[1], startB[1]), dy),
			)
			moveEnds(endsA, [startA[0] + dx, startA[1] + dy])
			moveEnds(endsB, [startB[0] + dx, startB[1] + dy])
		})
	}

	function pressOpening(e: PointerEvent, key: string): void {
		const id = Number(key.split(':')[1])
		if (tool() !== 'select') {
			return
		}
		setSelected({ kind: 'opening', id })
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const opening = openings().find((o: EditOpening) => o.id === id)
			const wall = walls().find((w: EditWall) => w.id === opening?.wall_id)
			if (!opening || !wall) {
				return
			}
			const hit = projectOnSegment(at, wall.a, wall.b)
			const offset = snapping(ev) ? roundTo(hit.offset, SNAP_STEP) : hit.offset
			patchOpening(id, { offset: clampOffset(wall, opening.width, offset) })
		})
	}

	function pressStair(e: PointerEvent, key: string): void {
		const id = Number(key.split(':')[1])
		const stair = stairs().find((s: EditStair) => s.id === id)
		if (!stair || tool() !== 'select') {
			return
		}
		setSelected({ kind: 'stair', id })
		const { a, b } = stair
		const from = stagePoint(e)
		const { width, height } = sheet()
		startEdit(e, (at: Point, ev: PointerEvent) => {
			let dx = at[0] - from[0]
			let dy = at[1] - from[1]
			if (snapping(ev)) {
				const snapped = snapPosition([a[0] + dx, a[1] + dy])
				dx = snapped[0] - a[0]
				dy = snapped[1] - a[1]
			}
			// Keep both ends on the sheet.
			dx = Math.min(width - Math.max(a[0], b[0]), Math.max(-Math.min(a[0], b[0]), dx))
			dy = Math.min(height - Math.max(a[1], b[1]), Math.max(-Math.min(a[1], b[1]), dy))
			patchStair(id, { a: [a[0] + dx, a[1] + dy], b: [b[0] + dx, b[1] + dy] })
		})
	}

	function dragStairEnd(e: PointerEvent, stair: EditStair, end: 'a' | 'b'): void {
		const other = end === 'a' ? stair.b : stair.a
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const to = snapCorner(ev, at, other)
			if (distance(to, other) >= MIN_WALL) {
				patchStair(stair.id, { [end]: to })
			}
		})
	}

	function pressTray(e: PointerEvent, key: string): void {
		const id = Number(key.split(':')[1])
		const tray = trays().find((x: EditTray) => x.id === id)
		if (!tray || tool() !== 'select') {
			return
		}
		setSelected({ kind: 'tray', id })
		const { a, b } = tray
		const endsA = runEndsAt(trays(), a)
		const endsB = runEndsAt(trays(), b)
		const exclude = new Set([...endsA, ...endsB].map((entry) => entry.id))
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const delta = keepOnSheet(
				[a, b],
				snapMove(
					ev,
					[a, b],
					[at[0] - from[0], at[1] - from[1]],
					faceTargets('tray', exclude),
				),
			)
			setTrays((all: EditTray[]) =>
				movedRunEnds(movedRunEnds(all, endsA, [a[0] + delta[0], a[1] + delta[1]]), endsB, [
					b[0] + delta[0],
					b[1] + delta[1],
				]),
			)
		})
	}

	function dragTrayEnd(e: PointerEvent, tray: EditTray, end: 'a' | 'b'): void {
		const ends = runEndsAt(trays(), tray[end])
		const exclude = new Set(ends.map((entry) => entry.id))
		const other = end === 'a' ? tray.b : tray.a
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const to = snapTo(ev, at, other, faceTargets('tray', exclude))
			if (distance(to, other) >= MIN_WALL) {
				setTrays((all: EditTray[]) => movedRunEnds(all, ends, to))
			}
		})
	}

	function pressDesk(e: PointerEvent, key: string): void {
		const id = Number(key.split(':')[1])
		const desk = desks().find((x: EditDesk) => x.id === id)
		if (!desk || tool() !== 'select') {
			return
		}
		setSelected({ kind: 'desk', id })
		const { a, b } = desk
		const corners = deskOutline(desk)
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const delta = keepOnSheet(
				[a, b],
				snapMove(
					ev,
					corners,
					[at[0] - from[0], at[1] - from[1]],
					faceTargets('desk', new Set([id])),
				),
			)
			patchDesk(id, {
				a: [a[0] + delta[0], a[1] + delta[1]],
				b: [b[0] + delta[0], b[1] + delta[1]],
			})
		})
	}

	function dragDeskEnd(e: PointerEvent, desk: EditDesk, end: 'a' | 'b'): void {
		const other = end === 'a' ? desk.b : desk.a
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const to = snapTo(ev, at, other, faceTargets('desk', new Set([desk.id])))
			if (distance(to, other) >= MIN_WALL) {
				patchDesk(desk.id, { [end]: to })
			}
		})
	}

	/**
	 * Where a desk group `shape` put at `raw` goes: while snapping, its
	 * corner nearest to a target lands on it, else its center on the 10 cm
	 * step; it stays on the sheet.
	 */
	function groupCenter(
		e: { altKey: boolean },
		shape: NewDeskGroup,
		raw: Point,
		excludeGroup: number | null,
	): Point {
		const corners = deskGroupCorners({ ...shape, center: raw })
		const delta = keepOnSheet(
			corners,
			snapMove(e, corners, [0, 0], faceTargets('desk', new Set(), excludeGroup)),
		)
		return [raw[0] + delta[0], raw[1] + delta[1]]
	}

	function pressDeskGroup(e: PointerEvent, key: string): void {
		const id = Number(key.split(':')[1])
		const group = deskGroups().find((x: EditDeskGroup) => x.id === id)
		if (!group || tool() !== 'select') {
			return
		}
		setSelected({ kind: 'deskGroup', id })
		const from = stagePoint(e)
		const { center } = group
		startEdit(e, (at: Point, ev: PointerEvent) => {
			patchDeskGroup(id, {
				center: groupCenter(
					ev,
					group,
					[center[0] + at[0] - from[0], center[1] + at[1] - from[1]],
					id,
				),
			})
		})
	}

	/** Drags the outer end of divider `index` around the group's center to rotate it, in 15° steps while snapping (Shift frees the angle). */
	function rotateDeskGroup(e: PointerEvent, group: EditDeskGroup, index: number): void {
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const dx = at[0] - group.center[0]
			const dy = at[1] - group.center[1]
			if (Math.hypot(dx, dy) < MIN_WALL) {
				return
			}
			// Divider `index` points 270° + 120° · index from the rotation.
			let rotation = (Math.atan2(dy, dx) * 180) / Math.PI - 270 - 120 * index
			if (snapping(ev) && !ev.shiftKey) {
				rotation = roundTo(rotation, ANGLE_STEP)
			}
			patchDeskGroup(group.id, { rotation: normalDegrees(rotation) })
		})
	}

	function pressRoom(e: PointerEvent, key: string): void {
		const id = Number(key.split(':')[1])
		const room = rooms().find((x: EditRoom) => x.id === id)
		if (!room || tool() !== 'select') {
			return
		}
		setSelected({ kind: 'room', id })
		const start = room.points
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const delta = keepOnSheet(
				start,
				snapMove(
					ev,
					start,
					[at[0] - from[0], at[1] - from[1]],
					faceTargets('room', new Set([id])),
				),
			)
			patchRoom(id, {
				points: start.map((p: Point): Point => [p[0] + delta[0], p[1] + delta[1]]),
			})
		})
	}

	function dragRoomCorner(e: PointerEvent, room: EditRoom, index: number): void {
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const to = snapTo(ev, at, null, faceTargets('room', new Set([room.id])))
			patchRoom(room.id, {
				points: room.points.map((p: Point, i: number) => (i === index ? to : p)),
			})
		})
	}

	/** Drops corner `index` of a room that keeps at least three. */
	function removeRoomCorner(room: EditRoom, index: number): void {
		if (room.points.length <= 3) {
			return
		}
		checkpoint()
		patchRoom(room.id, { points: room.points.filter((_, i: number) => i !== index) })
	}

	function dragMarker(e: PointerEvent, placement: FloorplanPlacementJson): void {
		if (tool() !== 'select') {
			return
		}
		setSelected({ kind: 'marker', id: placement.id })
		const from = stagePoint(e)
		const { width, height } = sheet()
		startEdit(e, (at: Point, ev: PointerEvent) => {
			let next: Point = [placement.x + at[0] - from[0], placement.y + at[1] - from[1]]
			if (snapping(ev)) {
				next = snapPosition(next)
			}
			const [x, y] = clampPoint(next, width, height)
			patchPlacement(placement.id, { x, y })
		})
	}

	function dragReference(e: PointerEvent): void {
		const start = reference()
		if (!start) {
			return
		}
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			let x = start.x + at[0] - from[0]
			let y = start.y + at[1] - from[1]
			if (snapping(ev)) {
				x = snapAxis(x)
				y = snapAxis(y)
			}
			setReference({ ...start, x, y })
		})
	}

	// --- edits --------------------------------------------------------------

	function patchWall(id: number, patch: Partial<EditWall>): void {
		setWalls((all: EditWall[]) =>
			all.map((wall: EditWall) => (wall.id === id ? { ...wall, ...patch } : wall)),
		)
	}

	function patchOpening(id: number, patch: Partial<EditOpening>): void {
		setOpenings((all: EditOpening[]) =>
			all.map((opening: EditOpening) =>
				opening.id === id ? { ...opening, ...patch } : opening,
			),
		)
	}

	function patchStair(id: number, patch: Partial<EditStair>): void {
		setStairs((all: EditStair[]) =>
			all.map((stair: EditStair) => (stair.id === id ? { ...stair, ...patch } : stair)),
		)
	}

	function patchTray(id: number, patch: Partial<EditTray>): void {
		setTrays((all: EditTray[]) =>
			all.map((tray: EditTray) => (tray.id === id ? { ...tray, ...patch } : tray)),
		)
	}

	function patchDesk(id: number, patch: Partial<EditDesk>): void {
		setDesks((all: EditDesk[]) =>
			all.map((desk: EditDesk) => (desk.id === id ? { ...desk, ...patch } : desk)),
		)
	}

	function patchDeskGroup(id: number, patch: Partial<EditDeskGroup>): void {
		setDeskGroups((all: EditDeskGroup[]) =>
			all.map((group: EditDeskGroup) => (group.id === id ? { ...group, ...patch } : group)),
		)
	}

	/** Resizes a desk group, keeping its front curve within what fits. */
	function resizeDeskGroup(group: EditDeskGroup, patch: Partial<NewDeskGroup>): void {
		checkpoint()
		const next = resized(group, patch)
		patchDeskGroup(group.id, {
			...next,
			center: groupCenter({ altKey: true }, next, next.center, group.id),
		})
	}

	/** Links desk `index` of a group to a location, or unlinks it. */
	function linkGroupDesk(group: EditDeskGroup, index: number, id: number | undefined): void {
		checkpoint()
		const location_ids: EditDeskGroup['location_ids'] = [...group.location_ids]
		location_ids[index] = id ?? null
		patchDeskGroup(group.id, { location_ids })
	}

	function patchRoom(id: number, patch: Partial<EditRoom>): void {
		setRooms((all: EditRoom[]) =>
			all.map((room: EditRoom) => (room.id === id ? { ...room, ...patch } : room)),
		)
	}

	function patchPlacement(id: number, patch: Partial<FloorplanPlacementJson>): void {
		setPlacements((all: FloorplanPlacementJson[]) =>
			all.map((p: FloorplanPlacementJson) => (p.id === id ? { ...p, ...patch } : p)),
		)
	}

	function clampOffset(wall: EditWall, width: number, offset: number): number {
		const length = wallLength(wall)
		const half = Math.min(width, length) / 2
		return Math.min(length - half, Math.max(half, offset))
	}

	function addWall(a: Point, b: Point): void {
		checkpoint()
		setWalls((all: EditWall[]) => [...all, { id: freshId(), a, b, thickness: thickness() }])
	}

	function addOpening(kind: OpeningKind, at: Point): void {
		const hit = wallAt(at)
		if (!hit || wallLength(hit.wall) < MIN_OPENING_WIDTH) {
			return
		}
		checkpoint()
		const width = Math.min(DEFAULT_OPENING_WIDTH[kind], wallLength(hit.wall))
		const offset = snapping({ altKey: false }) ? roundTo(hit.offset, SNAP_STEP) : hit.offset
		const id = freshId()
		setOpenings((all: EditOpening[]) => [
			...all,
			{
				id,
				wall_id: hit.wall.id,
				kind,
				offset: clampOffset(hit.wall, width, offset),
				width,
				hinge: 'start',
				side: 'left',
			},
		])
		setSelected({ kind: 'opening', id })
	}

	function addStair(a: Point, b: Point): void {
		checkpoint()
		const id = freshId()
		setStairs((all: EditStair[]) => [
			...all,
			{
				id,
				a,
				b,
				width: DEFAULT_STAIR_WIDTH,
				steps: defaultSteps(distance(a, b), MIN_STAIR_STEPS, MAX_STAIR_STEPS),
			},
		])
		setSelected({ kind: 'stair', id })
	}

	function addTray(a: Point, b: Point): void {
		checkpoint()
		setTrays((all: EditTray[]) => [...all, { id: freshId(), a, b, width: trayWidth() }])
	}

	function addDesk(a: Point, b: Point): void {
		checkpoint()
		const id = freshId()
		setDesks((all: EditDesk[]) => [...all, { id, a, b, depth: deskDepth() }])
		setSelected({ kind: 'desk', id })
	}

	function addDeskGroup(center: Point): void {
		checkpoint()
		const id = freshId()
		setDeskGroups((all: EditDeskGroup[]) => [
			...all,
			{ id, center, ...newGroup(), location_ids: [null, null, null] },
		])
		setSelected({ kind: 'deskGroup', id })
	}

	/** Closes the room being drawn when it has three corners; drops it otherwise. */
	function finishRoom(): void {
		const points = roomDraft()
		setRoomDraft(null)
		if (!points || points.length < 3) {
			return
		}
		checkpoint()
		const id = freshId()
		setRooms((all: EditRoom[]) => [...all, { id, points }])
		setTool('select')
		setSelected({ kind: 'room', id })
	}

	/** Sets the length of a segment from `a`, moving its end `b` along it. */
	function lengthened(a: Point, b: Point, length: number): Point {
		const { width, height } = sheet()
		return clampPoint(along(a, direction(a, b), length), width, height)
	}

	/** Sets the length of stairs, moving their head `b` along them. */
	function setStairLength(stair: EditStair, length: number): void {
		const u = direction(stair.a, stair.b)
		const { width, height } = sheet()
		checkpoint()
		patchStair(stair.id, { b: clampPoint(along(stair.a, u, length), width, height) })
	}

	/** Sets a wall's length, moving its end `b` (and the walls joined there) along it. */
	function setWallLength(wall: EditWall, length: number): void {
		const u = direction(wall.a, wall.b)
		const { width, height } = sheet()
		const to = clampPoint(along(wall.a, u, length), width, height)
		checkpoint()
		moveEnds(jointAt(wall.b), to)
	}

	function deleteSelected(): void {
		const current = selected()
		if (!current) {
			return
		}
		checkpoint()
		if (current.kind === 'wall') {
			setWalls((all: EditWall[]) => all.filter((wall: EditWall) => wall.id !== current.id))
			setOpenings((all: EditOpening[]) =>
				all.filter((opening: EditOpening) => opening.wall_id !== current.id),
			)
		} else if (current.kind === 'opening') {
			setOpenings((all: EditOpening[]) =>
				all.filter((opening: EditOpening) => opening.id !== current.id),
			)
		} else if (current.kind === 'stair') {
			setStairs((all: EditStair[]) =>
				all.filter((stair: EditStair) => stair.id !== current.id),
			)
		} else if (current.kind === 'tray') {
			setTrays((all: EditTray[]) => all.filter((x: EditTray) => x.id !== current.id))
		} else if (current.kind === 'desk') {
			setDesks((all: EditDesk[]) => all.filter((x: EditDesk) => x.id !== current.id))
		} else if (current.kind === 'deskGroup') {
			setDeskGroups((all: EditDeskGroup[]) =>
				all.filter((x: EditDeskGroup) => x.id !== current.id),
			)
		} else if (current.kind === 'room') {
			setRooms((all: EditRoom[]) => all.filter((x: EditRoom) => x.id !== current.id))
		} else {
			setPlacements((all: FloorplanPlacementJson[]) =>
				all.filter((p: FloorplanPlacementJson) => p.id !== current.id),
			)
		}
		setSelected(null)
	}

	function removeMarker(id: number): void {
		checkpoint()
		setPlacements((all: FloorplanPlacementJson[]) =>
			all.filter((p: FloorplanPlacementJson) => p.id !== id),
		)
		if (selected()?.kind === 'marker' && selected()?.id === id) {
			setSelected(null)
		}
	}

	function addPlacement(candidate: FloorplanCandidateJson, at: Point): void {
		const key = candidateKey(candidate)
		if (placed().has(key)) {
			return
		}
		checkpoint()
		const id = freshId()
		setPlacements((all: FloorplanPlacementJson[]) => [
			...all,
			{
				id,
				rack_id: candidate.rack_id,
				device_id: candidate.device_id,
				interface_id: candidate.interface_id,
				jack_id: candidate.jack_id,
				port: candidate.port,
				x: at[0],
				y: at[1],
				name: candidate.name,
				status: candidate.status,
				role_icon: candidate.role_icon,
			},
		])
		setSelected({ kind: 'marker', id })
	}

	/** Free outlets of a panel in port order. */
	function freeOutlets(panelId: number): FloorplanCandidateJson[] {
		return (candidates() ?? []).filter(
			(item: FloorplanCandidateJson) =>
				item.port?.device_id === panelId && !placed().has(candidateKey(item)),
		)
	}

	function placeNext(e: PointerEvent): void {
		e.preventDefault()
		e.stopPropagation()
		const panelId = sequence()
		const [next, ...rest] = panelId === null ? [] : freeOutlets(panelId)
		if (next) {
			addPlacement(next, stagePoint(e))
		}
		if (rest.length === 0) {
			setSequence(null)
		}
	}

	/** Door or window being dragged from the Draw tab, if any. */
	const draggedOpening = (): OpeningKind | null => {
		const kind = dragged()?.match(/^opening:(.+)$/)?.[1]
		return isOpeningKind(kind) ? kind : null
	}

	function onDrop(e: DragEvent): void {
		e.preventDefault()
		const key = dragged() ?? e.dataTransfer?.getData('text/plain')
		setDragged(null)
		setHover(null)
		const kind = key?.match(/^opening:(.+)$/)?.[1]
		if (isOpeningKind(kind)) {
			addOpening(kind, stagePoint(e))
			return
		}
		const candidate = candidates()?.find(
			(item: FloorplanCandidateJson) => candidateKey(item) === key,
		)
		if (candidate) {
			addPlacement(candidate, stagePoint(e))
		}
	}

	// --- sheet and reference image --------------------------------------------

	/** The smallest sheet side that still holds the drawing, cm. */
	function minSheet(): Point {
		const [x, y] = contentExtent(
			[
				...[...walls(), ...stairs(), ...trays(), ...desks()].flatMap((line) => [
					line.a,
					line.b,
				]),
				...desks().flatMap((desk: EditDesk) => deskOutline(desk)),
				...deskGroups().flatMap((group: EditDeskGroup) => deskGroupCorners(group)),
				...rooms().flatMap((room: EditRoom) => room.points),
			],
			placements(),
		)
		return [Math.max(100, Math.ceil(x)), Math.max(100, Math.ceil(y))]
	}

	function setSheetSide(side: 'width' | 'height', meters: number): void {
		const min = minSheet()[side === 'width' ? 0 : 1]
		const value = Math.min(MAX_DRAWING_CM, Math.max(min, Math.round(meters * 100)))
		if (value !== sheet()[side]) {
			checkpoint()
			setSheet({ ...sheet(), [side]: value })
		}
	}

	function imageHeight(ref: StageReference): number {
		return (ref.width * ref.attachment.height_px) / ref.attachment.width_px
	}

	/** Uses `image` as the reference, spread over the sheet's width the first time. */
	function chooseReference(image: AttachmentJson | null): void {
		checkpoint()
		if (!image) {
			setReference(null)
			setTool('select')
			return
		}
		const current = reference()
		const next: StageReference = current
			? { ...current, attachment_id: image.id, attachment: image }
			: { attachment_id: image.id, attachment: image, x: 0, y: 0, width: sheet().width }
		setReference(next)
		const needed = Math.ceil(next.y + imageHeight(next))
		if (!current && needed > sheet().height) {
			setSheet({ ...sheet(), height: Math.min(MAX_DRAWING_CM, needed) })
		}
	}

	async function uploadReference(file: File): Promise<void> {
		const res = await upload_attachment(owner, file)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		await refetchImages()
		chooseReference(res.value)
	}

	/** Grows the sheet to hold the reference image (from the sheet's top left). */
	function fitSheetToImage(): void {
		const ref = reference()
		if (!ref) {
			return
		}
		const [minX, minY] = minSheet()
		const width = Math.max(minX, Math.ceil(ref.x + ref.width))
		const height = Math.max(minY, Math.ceil(ref.y + imageHeight(ref)))
		checkpoint()
		setSheet({
			width: Math.min(MAX_DRAWING_CM, width),
			height: Math.min(MAX_DRAWING_CM, height),
		})
	}

	/**
	 * Scales the reference image so the two picked points lie `centimeters`
	 * apart, around the first point. Only the image changes: the sheet, walls,
	 * doors, windows and markers stay. Where the image sticks out of the sheet
	 * it is clipped; "Fit sheet to image" grows the sheet when wanted.
	 */
	function saveCalibration(centimeters: number): void {
		const points = calibration()
		const ref = reference()
		setAskDistance(false)
		setCalibration(null)
		setTool('select')
		if (!points?.b || !ref) {
			return
		}
		const measured = distance(points.a, points.b)
		if (measured <= 0) {
			return
		}
		const factor = centimeters / measured
		const [ax, ay] = points.a
		checkpoint()
		setReference({
			...ref,
			x: ax - (ax - ref.x) * factor,
			y: ay - (ay - ref.y) * factor,
			width: ref.width * factor,
		})
	}

	// --- tools ----------------------------------------------------------------

	function setTool(next: Tool): void {
		setToolSignal(next)
		setChain(null)
		setLineStart(null)
		setRoomDraft(null)
		setHover(null)
		setSnapMark(null)
		setCalibration(null)
		setSequence(null)
		if (next !== 'select') {
			setSelected(null)
		}
	}

	/** Pointer down on the draw layer of the active tool. */
	function toolPress(e: PointerEvent): void {
		if (e.pointerType === 'mouse' && e.button !== 0) {
			return
		}
		e.preventDefault()
		e.stopPropagation()
		const raw = stagePoint(e)
		switch (tool()) {
			case 'wall': {
				const current = chain()
				const at = snapCorner(e, raw, current?.last ?? null)
				if (!current) {
					setChain({ first: at, last: at })
					return
				}
				if (distance(current.last, at) < MIN_WALL) {
					return
				}
				addWall(current.last, at)
				setChain(samePoint(at, current.first) ? null : { first: current.first, last: at })
				return
			}
			case 'door':
			case 'sliding_door':
			case 'window':
				addOpening(tool() as OpeningKind, raw)
				return
			case 'stairs':
			case 'desk': {
				const start = lineStart()
				const isDesk = tool() === 'desk'
				const at = isDesk
					? snapTo(e, raw, start, faceTargets('desk', new Set()))
					: snapCorner(e, raw, start)
				if (!start) {
					setLineStart(at)
				} else if (distance(start, at) >= MIN_WALL) {
					setLineStart(null)
					if (isDesk) {
						addDesk(start, at)
					} else {
						addStair(start, at)
						setTool('select')
					}
				}
				return
			}
			case 'deskGroup':
				addDeskGroup(groupCenter(e, newGroup(), raw, null))
				return
			case 'tray': {
				const current = chain()
				const at = snapTo(e, raw, current?.last ?? null, faceTargets('tray', new Set()))
				if (!current) {
					setChain({ first: at, last: at })
					return
				}
				if (distance(current.last, at) < MIN_WALL) {
					return
				}
				addTray(current.last, at)
				setChain(samePoint(at, current.first) ? null : { first: current.first, last: at })
				return
			}
			case 'room': {
				const points = roomDraft() ?? []
				const at = snapTo(
					e,
					raw,
					points[points.length - 1] ?? null,
					faceTargets('room', new Set()),
				)
				// The second click of a double click lands on the corner just added.
				if (points.length > 0 && samePoint(points[points.length - 1] as Point, at)) {
					return
				}
				if (points.length >= 3 && samePoint(points[0] as Point, at)) {
					finishRoom()
					return
				}
				if (points.length < MAX_ROOM_POINTS) {
					setRoomDraft([...points, at])
				}
				return
			}
			case 'image':
				dragReference(e)
				return
			case 'calibrate': {
				const current = calibration()
				if (!current) {
					setCalibration({ a: raw, b: null })
				} else {
					const b = scaleEnd(e, current.a, raw)
					if (distance(current.a, b) > 0) {
						setCalibration({ a: current.a, b })
						setAskDistance(true)
					}
				}
				return
			}
		}
	}

	/**
	 * Second scale point: at a multiple of 15° from the first while snapping
	 * (Shift or Alt places it freely), so a scale along a wall in the image
	 * stays exactly horizontal or vertical.
	 */
	function scaleEnd(e: { altKey: boolean; shiftKey: boolean }, a: Point, raw: Point): Point {
		const { width, height } = sheet()
		return snapping(e) && !e.shiftKey
			? clampPoint(constrainAngle(a, raw, 0), width, height)
			: raw
	}

	function toolHover(e: PointerEvent): void {
		const raw = stagePoint(e)
		const first = calibration()?.a
		if (tool() === 'wall') {
			setHover(snapCorner(e, raw, chain()?.last ?? null))
		} else if (tool() === 'stairs') {
			setHover(snapCorner(e, raw, lineStart()))
		} else if (tool() === 'desk') {
			setHover(snapTo(e, raw, lineStart(), faceTargets('desk', new Set())))
		} else if (tool() === 'deskGroup') {
			setHover(groupCenter(e, newGroup(), raw, null))
		} else if (tool() === 'tray') {
			setHover(snapTo(e, raw, chain()?.last ?? null, faceTargets('tray', new Set())))
		} else if (tool() === 'room') {
			const points = roomDraft() ?? []
			setHover(
				snapTo(e, raw, points[points.length - 1] ?? null, faceTargets('room', new Set())),
			)
		} else if (tool() === 'calibrate' && first) {
			setHover(scaleEnd(e, first, raw))
		} else {
			setHover(raw)
		}
	}

	/** Preview of the door or window the tool would put under the pointer. */
	const ghostOpening = createMemo(() => {
		const kind = draggedOpening() ?? tool()
		const at = hover()
		if (!isOpeningKind(kind) || !at) {
			return null
		}
		const hit = wallAt(at)
		if (!hit || wallLength(hit.wall) < MIN_OPENING_WIDTH) {
			return null
		}
		const width = Math.min(DEFAULT_OPENING_WIDTH[kind], wallLength(hit.wall))
		return openingShape(hit.wall, {
			wall: 0,
			kind,
			offset: clampOffset(hit.wall, width, hit.offset),
			width,
			hinge: 'start',
			side: 'left',
		})
	})

	// --- keys, leave guard ----------------------------------------------------

	const onKeyDown = (e: KeyboardEvent): void => {
		if (typingIn(e.target)) {
			return
		}
		const mod = e.ctrlKey || e.metaKey
		if (mod && e.key.toLowerCase() === 'z') {
			e.preventDefault()
			if (e.shiftKey) {
				redo()
			} else {
				undo()
			}
			return
		}
		if (mod && e.key.toLowerCase() === 'y') {
			e.preventDefault()
			redo()
			return
		}
		if (e.key === 'Enter' && roomDraft()) {
			e.preventDefault()
			finishRoom()
			return
		}
		if (e.key === 'Escape' || e.key === 'Enter') {
			if (chain() || lineStart() || roomDraft() || calibration() || sequence() !== null) {
				e.preventDefault()
				setChain(null)
				setLineStart(null)
				setRoomDraft(null)
				setCalibration(null)
				setSequence(null)
				return
			}
			if (e.key === 'Escape') {
				if (tool() !== 'select') {
					setTool('select')
				} else {
					setSelected(null)
				}
			}
			return
		}
		if ((e.key === 'Delete' || e.key === 'Backspace') && selected()) {
			e.preventDefault()
			deleteSelected()
		}
	}
	onMount(() => window.addEventListener('keydown', onKeyDown))
	onCleanup(() => window.removeEventListener('keydown', onKeyDown))

	const warnUnload = (e: BeforeUnloadEvent): void => {
		if (dirty()) {
			e.preventDefault()
		}
	}
	onMount(() => window.addEventListener('beforeunload', warnUnload))
	onCleanup(() => window.removeEventListener('beforeunload', warnUnload))
	useLeaveGuard(dirty, () => t('floorplan.confirmCancel'))

	async function onSave(): Promise<void> {
		let saved: FloorplanDrawingJson | undefined
		const ok = await save.run(async () => {
			const res = await put_drawing(props.drawing.id, toPut(snapshot()))
			if (Result.isOk(res)) {
				saved = res.value
			}
			return res
		})
		if (ok && saved) {
			props.on_saved(saved)
		}
	}

	function onCancel(): void {
		if (!dirty() || window.confirm(t('floorplan.confirmCancel'))) {
			props.on_cancel()
		}
	}

	// --- rendering ------------------------------------------------------------

	const toPercent = (p: Point): { left: string; top: string } => ({
		left: percentOf(p[0], sheet().width),
		top: percentOf(p[1], sheet().height),
	})

	const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

	/** The wall or tray being drawn: from the chain's last corner to the pointer. */
	const draftRun = (kind: 'wall' | 'tray'): { a: Point; b: Point } | null => {
		const current = chain()
		const at = hover()
		return current && at && tool() === kind ? { a: current.last, b: at } : null
	}
	const draftWall = (): { a: Point; b: Point } | null => draftRun('wall')
	const draftTray = (): { a: Point; b: Point } | null => draftRun('tray')

	/** The stairs or desk being drawn: from their first end to the pointer. */
	const draftLine = (kind: 'stairs' | 'desk'): { a: Point; b: Point } | null => {
		const start = lineStart()
		const at = hover()
		return start && at && tool() === kind && distance(start, at) >= MIN_WALL
			? { a: start, b: at }
			: null
	}
	const draftStair = (): { a: Point; b: Point } | null => draftLine('stairs')
	const draftDesk = (): { a: Point; b: Point } | null => draftLine('desk')

	/** The desk group the tool would put under the pointer. */
	const draftGroup = (): DeskGroupShape | null => {
		const at = hover()
		return at && tool() === 'deskGroup' ? { ...newGroup(), center: at } : null
	}

	/**
	 * Label of a desk in the editor: the linked location's name; the desks of
	 * the selected group show their number too, which the inspector's
	 * location fields go by.
	 */
	const seatLabel = (seat: DeskSeat): string | undefined => {
		const name =
			seat.location_id === undefined ? undefined : knownLocations().get(seat.location_id)
		const current = selected()
		const prefix = current?.kind === 'deskGroup' ? `${keyOf(current)}:` : null
		if (prefix === null || !seat.key.startsWith(prefix)) {
			return name
		}
		const number = Number(seat.key.slice(prefix.length)) + 1
		return name ? t('drawnPlan.deskNumbered', { number, name }) : String(number)
	}

	/** The room being drawn, closed through the pointer. */
	const draftRoom = (): Point[] | null => {
		const points = roomDraft()
		const at = hover()
		return points && tool() === 'room' ? (at ? [...points, at] : points) : null
	}

	/** Label of a room or desk in the editor: the room's label, else the location's name. */
	const labelOf = (item: { location_id?: number; label?: string | null }): string | undefined =>
		item.label ||
		(item.location_id === undefined ? undefined : knownLocations().get(item.location_id))

	const calibrationLine = (): { a: Point; b: Point } | null => {
		const current = calibration()
		const b = current?.b ?? hover()
		return current && b ? { a: current.a, b } : null
	}

	const toolButton = (value: Tool, icon: typeof IconWall, label: string): JSX.Element => (
		<button
			type="button"
			class="drawn-plan-tool"
			aria-pressed={tool() === value}
			classList={{ active: tool() === value }}
			title={label}
			onClick={(): void => setTool(tool() === value && value !== 'select' ? 'select' : value)}
		>
			<IconLabel icon={icon}>{label}</IconLabel>
		</button>
	)

	return (
		<div class="floorplan-editor">
			<Show when={props.actions_mount}>
				{(mount: () => HTMLElement) => (
					<Portal mount={mount()}>
						<div class="modal-actions">
							<div class="floorplan-history">
								<button
									type="button"
									class="floorplan-history-button"
									aria-label={t('floorplan.undo')}
									title={t('floorplan.undoHint')}
									disabled={undoStack().length === 0}
									onClick={undo}
								>
									<IconArrowBackUp size={16} />
								</button>
								<button
									type="button"
									class="floorplan-history-button"
									aria-label={t('floorplan.redo')}
									title={t('floorplan.redoHint')}
									disabled={redoStack().length === 0}
									onClick={redo}
								>
									<IconArrowForwardUp size={16} />
								</button>
							</div>
							<button
								type="submit"
								onClick={() => void onSave()}
								disabled={save.pending() || !dirty()}
							>
								{save.pending() ? t('common.saving') : t('common.save')}
							</button>
							<button type="button" onClick={onCancel} disabled={save.pending()}>
								{t('common.cancel')}
							</button>
						</div>
					</Portal>
				)}
			</Show>
			<InlineError message={error()} />
			<div class="drawn-plan-layout">
				<aside class="floorplan-palette drawn-plan-panel" aria-label={t('drawnPlan.tools')}>
					<div class="floorplan-kinds floorplan-side-tabs">
						<button
							type="button"
							class="floorplan-side-tab drawn-plan-tab"
							aria-pressed={tab() === 'draw'}
							classList={{ active: tab() === 'draw' }}
							onClick={() => setTab('draw')}
						>
							{t('drawnPlan.drawTab')}
						</button>
						<button
							type="button"
							class="floorplan-side-tab drawn-plan-tab"
							aria-pressed={tab() === 'add'}
							classList={{ active: tab() === 'add' }}
							onClick={() => setTab('add')}
						>
							{t('drawnPlan.addTab', { count: freeCount() })}
						</button>
						<button
							type="button"
							class="floorplan-side-tab drawn-plan-tab"
							aria-pressed={tab() === 'plan'}
							classList={{ active: tab() === 'plan' }}
							onClick={() => setTab('plan')}
						>
							{t('drawnPlan.planTab')}
						</button>
					</div>
					<Switch>
						<Match when={tab() === 'draw'}>
							<section>
								<h5>{t('drawnPlan.elements')}</h5>
								<ul>
									<li>
										<button
											type="button"
											class="floorplan-palette-item drawn-plan-element"
											classList={{ active: tool() === 'wall' }}
											aria-pressed={tool() === 'wall'}
											title={t('drawnPlan.wallHint')}
											onClick={() =>
												setTool(tool() === 'wall' ? 'select' : 'wall')
											}
										>
											<IconWall size={14} />
											<span>{t('drawnPlan.toolWall')}</span>
										</button>
									</li>
									<For each={['door', 'sliding_door', 'window'] as const}>
										{(kind: OpeningKind) => {
											const ui = OPENING_UI[kind]
											const Icon = ui.icon
											return (
												<li>
													<button
														type="button"
														class="floorplan-palette-item drawn-plan-element"
														classList={{ active: tool() === kind }}
														aria-pressed={tool() === kind}
														title={t('drawnPlan.openingPlaceHint')}
														draggable="true"
														onDragStart={(e: DragEvent) => {
															e.dataTransfer?.setData(
																'text/plain',
																`opening:${kind}`,
															)
															setTool('select')
															setDragged(`opening:${kind}`)
														}}
														onDragEnd={() => {
															setDragged(null)
															setHover(null)
														}}
														onClick={() =>
															setTool(
																tool() === kind ? 'select' : kind,
															)
														}
													>
														<Icon size={14} />
														<span>{t(ui.tool)}</span>
													</button>
												</li>
											)
										}}
									</For>
									<li>
										<button
											type="button"
											class="floorplan-palette-item drawn-plan-element"
											classList={{ active: tool() === 'stairs' }}
											aria-pressed={tool() === 'stairs'}
											title={t('drawnPlan.stairsHint')}
											onClick={() =>
												setTool(tool() === 'stairs' ? 'select' : 'stairs')
											}
										>
											<IconStairsUp size={14} />
											<span>{t('drawnPlan.toolStairs')}</span>
										</button>
									</li>
									<For each={ELEMENT_TOOLS}>
										{(entry: ElementTool) => {
											const Icon = entry.icon
											const value = entry.tool
											return (
												<li>
													<button
														type="button"
														class="floorplan-palette-item drawn-plan-element"
														classList={{ active: tool() === value }}
														aria-pressed={tool() === value}
														title={t(entry.hint)}
														onClick={() =>
															setTool(
																tool() === value ? 'select' : value,
															)
														}
													>
														<Icon size={14} />
														<span>{t(entry.label)}</span>
													</button>
												</li>
											)
										}}
									</For>
								</ul>
							</section>
							<Show when={tool() === 'wall'}>
								<div class="drawn-plan-fields">
									<NumberField
										label={t('drawnPlan.newWallThickness')}
										value={thickness()}
										min={MIN_WALL_THICKNESS}
										max={MAX_WALL_THICKNESS}
										on_commit={setThickness}
									/>
								</div>
							</Show>
							<Show when={tool() === 'tray'}>
								<div class="drawn-plan-fields">
									<NumberField
										label={t('drawnPlan.newTrayWidth')}
										value={trayWidth()}
										min={MIN_TRAY_WIDTH}
										max={MAX_TRAY_WIDTH}
										on_commit={setTrayWidth}
									/>
								</div>
							</Show>
							<Show when={tool() === 'desk'}>
								<div class="drawn-plan-fields">
									<NumberField
										label={t('drawnPlan.depth')}
										value={deskDepth()}
										min={MIN_DESK_DEPTH}
										max={MAX_DESK_DEPTH}
										on_commit={setDeskDepth}
									/>
								</div>
							</Show>
							<Show when={tool() === 'deskGroup'}>
								<div class="drawn-plan-fields">
									<DeskGroupFields
										group={newGroup()}
										on_commit={(patch: Partial<NewDeskGroup>) =>
											setNewGroup(resized(newGroup(), patch))
										}
									/>
								</div>
							</Show>
							<p class="floorplan-hint">
								<Switch fallback={t('drawnPlan.drawHint')}>
									<Match when={tool() === 'wall'}>
										{t(
											chain()
												? 'drawnPlan.wallNextHint'
												: 'drawnPlan.wallHint',
										)}
									</Match>
									<Match when={isOpeningKind(tool())}>
										{t('drawnPlan.openingHint')}
									</Match>
									<Match when={tool() === 'stairs'}>
										{t(
											lineStart()
												? 'drawnPlan.stairsNextHint'
												: 'drawnPlan.stairsHint',
										)}
									</Match>
									<Match when={tool() === 'tray'}>
										{t(
											chain()
												? 'drawnPlan.wallNextHint'
												: 'drawnPlan.trayHint',
										)}
									</Match>
									<Match when={tool() === 'desk'}>
										{t(
											lineStart()
												? 'drawnPlan.deskNextHint'
												: 'drawnPlan.deskHint',
										)}
									</Match>
									<Match when={tool() === 'deskGroup'}>
										{t('drawnPlan.deskGroupHint')}
									</Match>
									<Match when={tool() === 'room'}>
										{t(
											roomDraft()
												? 'drawnPlan.roomNextHint'
												: 'drawnPlan.roomHint',
										)}
									</Match>
								</Switch>
							</p>
						</Match>
						<Match when={tab() === 'add'}>
							<Show when={sequence() !== null}>
								<p class="floorplan-hint">{t('floorplan.sequenceActive')}</p>
							</Show>
							<input
								type="search"
								class="floorplan-palette-search"
								value={search()}
								placeholder={t('floorplan.paletteSearch')}
								aria-label={t('floorplan.paletteSearch')}
								onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
									setSearch(e.currentTarget.value)
								}
							/>
							<Palette
								search={search()}
								candidates={candidates()}
								loading={candidates.loading}
								placed={placed()}
								sequence={sequence()}
								on_sequence={(panelId: number | null) => {
									setTool('select')
									setSequence(panelId)
								}}
								on_drag={setDragged}
								on_place={(candidate: FloorplanCandidateJson) => {
									const [cx, cy] = zoom.viewCenter()
									addPlacement(candidate, [
										cx * sheet().width,
										cy * sheet().height,
									])
								}}
							/>
						</Match>
						<Match when={tab() === 'plan'}>
							<h5>{t('drawnPlan.sheet')}</h5>
							<div class="drawn-plan-fields">
								<NumberField
									label={t('drawnPlan.sheetWidth')}
									value={sheet().width / 100}
									min={1}
									max={MAX_DRAWING_CM / 100}
									step={0.1}
									on_commit={(value: number) => setSheetSide('width', value)}
								/>
								<NumberField
									label={t('drawnPlan.sheetHeight')}
									value={sheet().height / 100}
									min={1}
									max={MAX_DRAWING_CM / 100}
									step={0.1}
									on_commit={(value: number) => setSheetSide('height', value)}
								/>
							</div>

							<h5>{t('drawnPlan.reference')}</h5>
							<div class="drawn-plan-fields">
								<label>
									<span>{t('drawnPlan.referenceImage')}</span>
									<select
										class="drawn-plan-control"
										value={String(reference()?.attachment.id ?? '')}
										onChange={(
											e: Event & { currentTarget: HTMLSelectElement },
										) => {
											const id = Number(e.currentTarget.value)
											chooseReference(
												(images() ?? []).find(
													(image: AttachmentJson) => image.id === id,
												) ?? null,
											)
										}}
									>
										<option value="">{t('drawnPlan.noReference')}</option>
										<For each={images() ?? []}>
											{(image: AttachmentJson) => (
												<option value={String(image.id)}>
													{image.description || image.filename}
												</option>
											)}
										</For>
									</select>
								</label>
								<label class="drawn-plan-upload">
									<IconLabel icon={IconPhotoUp}>
										{t('drawnPlan.uploadReference')}
									</IconLabel>
									<input
										type="file"
										class="drawn-plan-upload-input"
										accept="image/png,image/jpeg"
										onChange={(
											e: Event & { currentTarget: HTMLInputElement },
										) => {
											const file = e.currentTarget.files?.[0]
											e.currentTarget.value = ''
											if (file) {
												void uploadReference(file)
											}
										}}
									/>
								</label>
							</div>
							<Show when={reference()}>
								<label class="drawn-plan-opacity">
									<span>{t('drawnPlan.opacity')}</span>
									<input
										type="range"
										min="0.1"
										max="1"
										step="0.05"
										value={String(referenceOpacity())}
										onInput={(
											e: InputEvent & { currentTarget: HTMLInputElement },
										) => setReferenceOpacity(Number(e.currentTarget.value))}
									/>
								</label>
								<div class="drawn-plan-tools">
									{toolButton('image', IconPhotoUp, t('drawnPlan.moveImage'))}
									{toolButton(
										'calibrate',
										IconRulerMeasure,
										t('drawnPlan.calibrate'),
									)}
								</div>
								<button
									type="button"
									class="floorplan-draw-toggle"
									onClick={fitSheetToImage}
								>
									{t('drawnPlan.fitSheet')}
								</button>
							</Show>
							<Switch>
								<Match when={tool() === 'image'}>
									<p class="floorplan-hint">{t('drawnPlan.moveImageHint')}</p>
								</Match>
								<Match when={tool() === 'calibrate'}>
									<p class="floorplan-hint">
										{t(
											calibration()
												? 'floorplan.scaleSecondHint'
												: 'drawnPlan.calibrateHint',
										)}
									</p>
								</Match>
							</Switch>
						</Match>
					</Switch>
				</aside>
				<div>
					<DrawnPlanStage
						sheet={sheet()}
						zoom={zoom}
						reference={reference()}
						reference_opacity={referenceOpacity()}
						grid={gridStep()}
						pointer={pointer()}
						ref={setStage}
						onPointerMove={(e: PointerEvent) => setPointer(stagePoint(e))}
						onPointerLeave={() => setPointer(null)}
						handlers={{
							onPointerDown: () => {
								if (tool() === 'select') {
									setSelected(null)
								}
							},
							onDragOver: (e: DragEvent) => {
								if (dragged() !== null) {
									e.preventDefault()
								}
								if (draggedOpening()) {
									setHover(stagePoint(e))
								}
							},
							onDragLeave: () => {
								if (draggedOpening()) {
									setHover(null)
								}
							},
							onDrop,
						}}
						bar={
							<>
								<label class="floorplan-grid-size">
									<span>{t('floorplan.gridSize')}</span>
									<select
										value={String(gridStep())}
										onChange={(
											e: Event & { currentTarget: HTMLSelectElement },
										) => {
											const value = Number(e.currentTarget.value)
											setGridStep(
												GRID_STEPS.find((step) => step === value) ??
													DEFAULT_GRID_STEP,
											)
										}}
									>
										<For each={GRID_STEPS}>
											{(step: GridStep) => (
												<option value={String(step)}>
													{formatLength(step)}
												</option>
											)}
										</For>
									</select>
								</label>
								<button
									type="button"
									class="floorplan-layer-toggle floorplan-names-toggle"
									aria-pressed={snapEnabled()}
									title={t('drawnPlan.snapHint')}
									onClick={toggleSnap}
								>
									<IconMagnet size={12} aria-hidden="true" />
									<span>{t('drawnPlan.snap')}</span>
								</button>
							</>
						}
						walls={
							<>
								<RoomLayer
									rooms={stageRooms()}
									selected={selected() ? keyOf(selected() as Selected) : null}
									on_press={pressRoom}
								/>
								<StairLayer
									stairs={stageStairs()}
									selected={selected() ? keyOf(selected() as Selected) : null}
									on_press={pressStair}
								/>
								<DeskLayer
									desks={stageDesks()}
									selected={selected() ? keyOf(selected() as Selected) : null}
									on_press={pressDesk}
								/>
								<DeskGroupLayer
									groups={stageGroups()}
									selected={selected() ? keyOf(selected() as Selected) : null}
									on_press={pressDeskGroup}
								/>
								<TrayLayer
									trays={stageTrays()}
									selected={selected() ? keyOf(selected() as Selected) : null}
									on_press={pressTray}
								/>
								<WallLayer
									walls={stageWalls()}
									selected={selected() ? keyOf(selected() as Selected) : null}
									on_wall_press={pressWall}
									on_opening_press={pressOpening}
								/>
							</>
						}
						svg={
							<>
								<Show when={ghostOpening()}>
									{(shape: () => ReturnType<typeof openingShape>) => (
										<g class="drawn-plan-opening drawn-plan-ghost">
											<OpeningGlyph shape={shape()} />
										</g>
									)}
								</Show>
								<Show when={draftStair()}>
									{(line: () => { a: Point; b: Point }) => (
										<g class="drawn-plan-stairs drawn-plan-ghost">
											<StairGlyph
												shape={stairShape({
													...line(),
													width: DEFAULT_STAIR_WIDTH,
													steps: defaultSteps(
														distance(line().a, line().b),
														MIN_STAIR_STEPS,
														MAX_STAIR_STEPS,
													),
												})}
											/>
										</g>
									)}
								</Show>
								<Show when={draftRoom()}>
									{(points: () => Point[]) => (
										<polygon
											class="drawn-plan-room-area drawn-plan-ghost"
											points={svgPoints(points())}
										/>
									)}
								</Show>
								<Show when={draftDesk()}>
									{(line: () => { a: Point; b: Point }) => (
										<polygon
											class="drawn-plan-desk drawn-plan-ghost"
											points={svgPoints(
												deskOutline({ ...line(), depth: deskDepth() }),
											)}
										/>
									)}
								</Show>
								<Show when={draftGroup()}>
									{(group: () => DeskGroupShape) => (
										<g class="drawn-plan-ghost">
											<For each={DESK_GROUP_DESKS}>
												{(index: number) => (
													<polygon
														class="drawn-plan-desk"
														points={svgPoints(
															deskGroupDesk(group(), index),
														)}
													/>
												)}
											</For>
										</g>
									)}
								</Show>
								<Show when={draftTray()}>
									{(line: () => { a: Point; b: Point }) => (
										<g class="drawn-plan-trays drawn-plan-ghost">
											<line
												class="drawn-plan-tray-body"
												x1={line().a[0]}
												y1={line().a[1]}
												x2={line().b[0]}
												y2={line().b[1]}
												stroke-width={trayWidth()}
											/>
										</g>
									)}
								</Show>
								<Show when={draftWall()}>
									{(line: () => { a: Point; b: Point }) => (
										<line
											class="drawn-plan-draft"
											x1={line().a[0]}
											y1={line().a[1]}
											x2={line().b[0]}
											y2={line().b[1]}
											stroke-width={thickness()}
										/>
									)}
								</Show>
								<Show when={calibrationLine()}>
									{(line: () => { a: Point; b: Point }) => (
										<line
											class="floorplan-scale-line floorplan-scale-line-draft"
											x1={line().a[0]}
											y1={line().a[1]}
											x2={line().b[0]}
											y2={line().b[1]}
										/>
									)}
								</Show>
							</>
						}
					>
						<For each={rooms()}>
							{(room: EditRoom) => (
								<Show when={labelOf(room)}>
									{(text: () => string) => (
										<span
											class="drawn-plan-name drawn-plan-name-editing"
											classList={{
												selected:
													selected()?.kind === 'room' &&
													selected()?.id === room.id,
											}}
											style={toPercent(polygonCenter(room.points))}
											onPointerDown={(e: PointerEvent) =>
												pressRoom(e, `room:${room.id}`)
											}
										>
											{text()}
										</span>
									)}
								</Show>
							)}
						</For>
						<For each={seats()}>
							{(seat: DeskSeat) => (
								<Show when={seatLabel(seat)}>
									{(text: () => string) => (
										<span
											class="drawn-plan-name drawn-plan-name-desk drawn-plan-name-passive"
											style={toPercent(seat.at)}
										>
											{text()}
										</span>
									)}
								</Show>
							)}
						</For>
						<For each={placements()}>
							{(placement: FloorplanPlacementJson) => (
								<div
									class="floorplan-marker floorplan-marker-editing"
									classList={{
										...markerClasses(placement),
										selected:
											selected()?.kind === 'marker' &&
											selected()?.id === placement.id,
									}}
									style={toPercent([placement.x, placement.y])}
									title={markerTitle(placement)}
									onPointerDown={(e: PointerEvent) => dragMarker(e, placement)}
								>
									<MarkerGlyph placement={placement} size={16} />
									<MarkerName placement={placement} />
									<button
										type="button"
										class="floorplan-marker-remove"
										aria-label={t('floorplan.removeMarker', {
											name: placement.name,
										})}
										title={t('floorplan.removeMarker', {
											name: placement.name,
										})}
										onPointerDown={(e: PointerEvent) => e.stopPropagation()}
										onClick={() => removeMarker(placement.id)}
									>
										<IconX size={10} />
									</button>
								</div>
							)}
						</For>
						<Show when={selectedWall()}>
							{(wall: () => EditWall) => (
								<>
									<For each={['a', 'b'] as const}>
										{(end: 'a' | 'b') => (
											<div
												class="floorplan-handle floorplan-handle-vertex"
												style={toPercent(wall()[end])}
												title={t('drawnPlan.wallEnd')}
												onPointerDown={(e: PointerEvent) =>
													dragEnd(e, wall(), end)
												}
											/>
										)}
									</For>
									<span
										class="drawn-plan-label"
										style={toPercent(midpoint(wall().a, wall().b))}
									>
										{formatLength(wallLength(wall()))}
									</span>
								</>
							)}
						</Show>
						<Show when={selectedStair()}>
							{(stair: () => EditStair) => (
								<>
									<For each={['a', 'b'] as const}>
										{(end: 'a' | 'b') => (
											<div
												class="floorplan-handle floorplan-handle-vertex"
												style={toPercent(stair()[end])}
												title={t(
													end === 'a'
														? 'drawnPlan.stairFoot'
														: 'drawnPlan.stairHead',
												)}
												onPointerDown={(e: PointerEvent) =>
													dragStairEnd(e, stair(), end)
												}
											/>
										)}
									</For>
									<span
										class="drawn-plan-label"
										style={toPercent(midpoint(stair().a, stair().b))}
									>
										{formatLength(distance(stair().a, stair().b))}
									</span>
								</>
							)}
						</Show>
						<Show when={selectedTray()}>
							{(tray: () => EditTray) => (
								<>
									<For each={['a', 'b'] as const}>
										{(end: 'a' | 'b') => (
											<div
												class="floorplan-handle floorplan-handle-vertex"
												style={toPercent(tray()[end])}
												title={t('drawnPlan.trayEnd')}
												onPointerDown={(e: PointerEvent) =>
													dragTrayEnd(e, tray(), end)
												}
											/>
										)}
									</For>
									<span
										class="drawn-plan-label"
										style={toPercent(midpoint(tray().a, tray().b))}
									>
										{formatLength(distance(tray().a, tray().b))}
									</span>
								</>
							)}
						</Show>
						<Show when={selectedDesk()}>
							{(desk: () => EditDesk) => (
								<>
									<For each={['a', 'b'] as const}>
										{(end: 'a' | 'b') => (
											<div
												class="floorplan-handle floorplan-handle-vertex"
												style={toPercent(desk()[end])}
												title={t('drawnPlan.deskCorner')}
												onPointerDown={(e: PointerEvent) =>
													dragDeskEnd(e, desk(), end)
												}
											/>
										)}
									</For>
									<span
										class="drawn-plan-label"
										style={toPercent(midpoint(desk().a, desk().b))}
									>
										{formatLength(distance(desk().a, desk().b))}
									</span>
								</>
							)}
						</Show>
						<Show when={selectedGroup()}>
							{(group: () => EditDeskGroup) => (
								<For each={deskGroupArms(group())}>
									{(end: Point, index: () => number) => (
										<div
											class="floorplan-handle floorplan-handle-vertex"
											style={toPercent(end)}
											title={t('drawnPlan.dividerEnd')}
											onPointerDown={(e: PointerEvent) =>
												rotateDeskGroup(e, group(), index())
											}
										/>
									)}
								</For>
							)}
						</Show>
						<Show when={selectedRoom()}>
							{(room: () => EditRoom) => (
								<For each={room().points}>
									{(point: Point, index: () => number) => (
										// biome-ignore lint/a11y/noStaticElementInteractions: Pointer-only handle like the other corner handles; the double click is a shortcut, Delete removes the room.
										<div
											class="floorplan-handle floorplan-handle-vertex"
											style={toPercent(point)}
											title={t('drawnPlan.roomCorner')}
											onPointerDown={(e: PointerEvent) =>
												dragRoomCorner(e, room(), index())
											}
											onDblClick={() => removeRoomCorner(room(), index())}
										/>
									)}
								</For>
							)}
						</Show>
						<Show when={draftStair() ?? draftDesk() ?? draftTray() ?? draftWall()}>
							{(line: () => { a: Point; b: Point }) => (
								<span
									class="drawn-plan-label"
									style={toPercent(midpoint(line().a, line().b))}
								>
									{formatLength(distance(line().a, line().b))}
								</span>
							)}
						</Show>
						<Show when={snapMark()}>
							{(point: () => Point) => (
								<span
									class="floorplan-snap-mark"
									style={toPercent(point())}
									aria-hidden="true"
								/>
							)}
						</Show>
						<Show when={sequence() !== null}>
							<div class="floorplan-sequence-layer" onPointerDown={placeNext} />
						</Show>
						<Show when={tool() !== 'select'}>
							{/* Covers the sheet so the pointer draws instead of moving what lies below. */}
							{/* biome-ignore lint/a11y/noStaticElementInteractions: Pointer-only drawing; Enter and Escape end a wall chain from the keyboard. */}
							<div
								class="floorplan-draw-layer"
								classList={{ 'drawn-plan-move-layer': tool() === 'image' }}
								onPointerDown={toolPress}
								onPointerMove={toolHover}
								onPointerLeave={() => {
									setHover(null)
									setSnapMark(null)
								}}
								onDblClick={() => {
									setChain(null)
									if (tool() === 'room') {
										finishRoom()
									}
								}}
							/>
						</Show>
					</DrawnPlanStage>
					<Switch>
						<Match when={selectedWall()}>
							{(wall: () => EditWall) => (
								<div class="floorplan-inspector">
									<NumberField
										label={t('drawnPlan.length')}
										value={wallLength(wall())}
										min={MIN_WALL}
										max={MAX_DRAWING_CM}
										on_commit={(value: number) => setWallLength(wall(), value)}
									/>
									<NumberField
										label={t('drawnPlan.thickness')}
										value={wall().thickness}
										min={MIN_WALL_THICKNESS}
										max={MAX_WALL_THICKNESS}
										on_commit={(value: number) => {
											checkpoint()
											patchWall(wall().id, { thickness: value })
										}}
									/>
									<button type="button" onClick={deleteSelected}>
										{t('drawnPlan.deleteWall')}
									</button>
								</div>
							)}
						</Match>
						<Match when={selectedOpening()}>
							{(opening: () => EditOpening) => (
								<div class="floorplan-inspector">
									<label>
										<span>{t('common.type')}</span>
										<select
											value={opening().kind}
											onChange={(
												e: Event & { currentTarget: HTMLSelectElement },
											) => {
												const kind = e.currentTarget.value
												if (isOpeningKind(kind)) {
													checkpoint()
													patchOpening(opening().id, { kind })
												}
											}}
										>
											<For each={['door', 'sliding_door', 'window'] as const}>
												{(kind: OpeningKind) => (
													<option value={kind}>
														{t(OPENING_UI[kind].name)}
													</option>
												)}
											</For>
										</select>
									</label>
									<NumberField
										label={t('drawnPlan.width')}
										value={opening().width}
										min={MIN_OPENING_WIDTH}
										max={MAX_OPENING_WIDTH}
										on_commit={(value: number) => {
											const wall = walls().find(
												(w: EditWall) => w.id === opening().wall_id,
											)
											const width = wall
												? Math.min(value, wallLength(wall))
												: value
											checkpoint()
											patchOpening(opening().id, {
												width,
												offset: wall
													? clampOffset(wall, width, opening().offset)
													: opening().offset,
											})
										}}
									/>
									<Show when={opening().kind !== 'window'}>
										<button
											type="button"
											onClick={() => {
												checkpoint()
												patchOpening(opening().id, {
													hinge:
														opening().hinge === 'start'
															? 'end'
															: 'start',
												})
											}}
										>
											{t(
												opening().kind === 'sliding_door'
													? 'drawnPlan.flipSlide'
													: 'drawnPlan.flipHinge',
											)}
										</button>
										<button
											type="button"
											onClick={() => {
												checkpoint()
												patchOpening(opening().id, {
													side:
														opening().side === 'left'
															? 'right'
															: 'left',
												})
											}}
										>
											{t(
												opening().kind === 'sliding_door'
													? 'drawnPlan.flipSlideSide'
													: 'drawnPlan.flipSwing',
											)}
										</button>
									</Show>
									<button type="button" onClick={deleteSelected}>
										{t(OPENING_UI[opening().kind].remove)}
									</button>
								</div>
							)}
						</Match>
						<Match when={selectedStair()}>
							{(stair: () => EditStair) => (
								<div class="floorplan-inspector">
									<NumberField
										label={t('drawnPlan.length')}
										value={distance(stair().a, stair().b)}
										min={MIN_WALL}
										max={MAX_DRAWING_CM}
										on_commit={(value: number) =>
											setStairLength(stair(), value)
										}
									/>
									<NumberField
										label={t('drawnPlan.width')}
										value={stair().width}
										min={MIN_STAIR_WIDTH}
										max={MAX_STAIR_WIDTH}
										on_commit={(value: number) => {
											checkpoint()
											patchStair(stair().id, { width: value })
										}}
									/>
									<NumberField
										label={t('drawnPlan.steps')}
										value={stair().steps}
										min={MIN_STAIR_STEPS}
										max={MAX_STAIR_STEPS}
										on_commit={(value: number) => {
											checkpoint()
											patchStair(stair().id, { steps: Math.round(value) })
										}}
									/>
									<button
										type="button"
										onClick={() => {
											checkpoint()
											patchStair(stair().id, { a: stair().b, b: stair().a })
										}}
									>
										{t('drawnPlan.flipStairs')}
									</button>
									<button type="button" onClick={deleteSelected}>
										{t('drawnPlan.deleteStairs')}
									</button>
								</div>
							)}
						</Match>
						<Match when={selectedTray()}>
							{(tray: () => EditTray) => (
								<div class="floorplan-inspector">
									<NumberField
										label={t('drawnPlan.length')}
										value={distance(tray().a, tray().b)}
										min={MIN_WALL}
										max={MAX_DRAWING_CM}
										on_commit={(value: number) => {
											const to = lengthened(tray().a, tray().b, value)
											checkpoint()
											setTrays((all: EditTray[]) =>
												movedRunEnds(all, runEndsAt(all, tray().b), to),
											)
										}}
									/>
									<NumberField
										label={t('drawnPlan.width')}
										value={tray().width}
										min={MIN_TRAY_WIDTH}
										max={MAX_TRAY_WIDTH}
										on_commit={(value: number) => {
											checkpoint()
											patchTray(tray().id, { width: value })
										}}
									/>
									<button type="button" onClick={deleteSelected}>
										{t('drawnPlan.deleteTray')}
									</button>
								</div>
							)}
						</Match>
						<Match when={selectedDesk()}>
							{(desk: () => EditDesk) => (
								<div class="floorplan-inspector">
									<NumberField
										label={t('drawnPlan.length')}
										value={distance(desk().a, desk().b)}
										min={MIN_WALL}
										max={MAX_DRAWING_CM}
										on_commit={(value: number) => {
											checkpoint()
											patchDesk(desk().id, {
												b: lengthened(desk().a, desk().b, value),
											})
										}}
									/>
									<NumberField
										label={t('drawnPlan.depth')}
										value={desk().depth}
										min={MIN_DESK_DEPTH}
										max={MAX_DESK_DEPTH}
										on_commit={(value: number) => {
											checkpoint()
											patchDesk(desk().id, { depth: value })
										}}
									/>
									<LocationField
										value={desk().location_id}
										locations={linkLocations() ?? []}
										known={knownLocations()}
										on_commit={(location_id: number | undefined) => {
											checkpoint()
											patchDesk(desk().id, { location_id })
										}}
									/>
									<button
										type="button"
										onClick={() => {
											checkpoint()
											patchDesk(desk().id, { a: desk().b, b: desk().a })
										}}
									>
										{t('drawnPlan.flipDesk')}
									</button>
									<button type="button" onClick={deleteSelected}>
										{t('drawnPlan.deleteDesk')}
									</button>
								</div>
							)}
						</Match>
						<Match when={selectedGroup()}>
							{(group: () => EditDeskGroup) => (
								<div class="floorplan-inspector">
									<DeskGroupFields
										group={group()}
										on_commit={(patch: Partial<NewDeskGroup>) =>
											resizeDeskGroup(group(), patch)
										}
									/>
									<For each={DESK_GROUP_DESKS}>
										{(index: number) => (
											<LocationField
												label={t('drawnPlan.deskNumber', {
													number: index + 1,
												})}
												value={group().location_ids[index] ?? undefined}
												locations={linkLocations() ?? []}
												known={knownLocations()}
												on_commit={(id: number | undefined) =>
													linkGroupDesk(group(), index, id)
												}
											/>
										)}
									</For>
									<button type="button" onClick={deleteSelected}>
										{t('drawnPlan.deleteDeskGroup')}
									</button>
								</div>
							)}
						</Match>
						<Match when={selectedRoom()}>
							{(room: () => EditRoom) => (
								<div class="floorplan-inspector">
									<LocationField
										value={room().location_id}
										locations={linkLocations() ?? []}
										known={knownLocations()}
										on_commit={(location_id: number | undefined) => {
											checkpoint()
											patchRoom(room().id, { location_id })
										}}
									/>
									<TextField
										label={t('drawnPlan.roomLabel')}
										value={room().label ?? ''}
										placeholder={
											room().location_id === undefined
												? undefined
												: knownLocations().get(room().location_id as number)
										}
										max={100}
										on_commit={(label: string) => {
											checkpoint()
											patchRoom(room().id, { label: label || undefined })
										}}
									/>
									<button type="button" onClick={deleteSelected}>
										{t('drawnPlan.deleteRoom')}
									</button>
								</div>
							)}
						</Match>
						<Match when={selectedMarker()}>
							{(marker: () => FloorplanPlacementJson) => (
								<div class="floorplan-inspector">
									<span>{marker().name}</span>
									<button type="button" onClick={() => removeMarker(marker().id)}>
										{t('floorplan.removeMarker', { name: marker().name })}
									</button>
								</div>
							)}
						</Match>
					</Switch>
				</div>
			</div>
			<Show when={askDistance()}>
				<ScaleDistanceDialog
					centimeters={null}
					on_save={saveCalibration}
					on_close={() => {
						setAskDistance(false)
						setCalibration(null)
					}}
				/>
			</Show>
		</div>
	)
}
