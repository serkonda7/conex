/**
 * Edit mode of a drawn floor plan. Works on a draft copy and sends it with
 * one `PUT` on save; cancel discards it.
 *
 * - Select (default): click a wall, door, window, stairs, cable tray, desk,
 *   desk group, room (by its outline or label) or marker to select it, drag
 *   it to move it. A selected wall, flight of stairs, tray or desk shows
 *   handles on its ends, a room on its corners, a desk group on its divider
 *   ends (drag to rotate); walls (and trays) joined at a moved end follow
 *   it. Below the selection sit quick actions (rotate 90°, flip, duplicate,
 *   delete); a desk, desk group or stairs shows its distances to the
 *   nearest objects on each side, a door or window to the ends of its
 *   stretch of wall. The inspector below the stage edits the selection
 *   (length, thickness, width, swing, steps, depth, rotation, linked
 *   locations, label) and deletes it.
 * - Drawing tools stay picked after each element, until Escape or another
 *   tool; the element just put down is selected.
 * - Wall / cable tray: each click adds a corner, chaining runs; clicking the
 *   chain's first corner closes it, a double click, Enter or Escape ends it.
 *   While drawing a wall, tray, stairs or room, typing a number sets the
 *   next line's length in cm toward the pointer; Enter puts it down.
 * - Door / sliding door / window: a click on a wall puts one there.
 * - Stairs: a click at the foot, then one at the head.
 * - Desk: a click puts one down at the length and depth set beside the
 *   stage, its back against the nearest wall face within its depth; a drag
 *   draws its back edge instead (the desk lies to the left of it, "Flip
 *   side" turns it over).
 * - Desk group: a click puts three desks around a divider there, at the
 *   rotation and size set beside the stage.
 * - Room: each click adds a corner; clicking the first corner, a double
 *   click or Enter closes it, Escape drops it.
 * - Snap (toggle; Alt skips it, `drawn_plan_snap`): wall corners snap to
 *   wall ends, then onto walls; stairs, desks, desk groups and rooms to the
 *   walls' faces and to each other's corners and edges, trays to the faces
 *   and other trays, markers to desks and rooms. A moved object snaps corner
 *   on corner or flush against an edge (sliding into the next contact), else
 *   lines up its edges or center with other objects along dashed guides;
 *   otherwise everything takes 10 cm steps. Lines from a previous point keep
 *   multiples of 15°; Shift frees the angle.
 * - Keys: 1–9 pick the Draw tab's elements (unless typing a length), Ctrl + D duplicates the
 *   selection beside it (again on the copy repeats the step), the arrow
 *   keys nudge it (10 cm, Shift 1 m, Alt 1 cm).
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
	IconCopy,
	IconDesk,
	IconDoor,
	IconFlipVertical,
	IconMagnet,
	IconPhotoUp,
	IconPolygon,
	IconRotateClockwise,
	IconRoute,
	IconRulerMeasure,
	IconStairsUp,
	IconTopologyStar3,
	IconTrash,
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
	DEFAULT_DESK_LENGTH,
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
	openingShape,
	openingSpan,
	type Point,
	polygonCenter,
	projectOnSegment,
	roundTo,
	SAME_JOINT,
	samePoint,
	stairShape,
	wallFaceTargets,
	wallLength,
} from './drawn_plan_geometry'
import {
	type Box,
	boxOf,
	rayHit,
	ringEdges,
	type SnapTargets,
	snapPoint,
	snapShift,
} from './drawn_plan_snap'
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
import { type Guide, snapEnabled, toggleSnap } from './floorplan_snap'
import { MarkerGlyph, MarkerName, markerClasses, markerTitle } from './floorplan_stage'
import { IconLabel } from './icon_label'
import type { StageZoom } from './zoom_viewport'

/** Snap range on screen, px. */
const SNAP_PX = 10

/** Snap step of points, lengths and moves, cm, whatever the grid size. */
const SNAP_STEP = 10

/** Shortest wall kept, cm. */
const MIN_WALL = 1

/** Pointer travel on screen (px) that turns a press of the desk tool into a drag. */
const DRAG_PX = 4

/** Longest desk put down with one click, cm. */
const MAX_DESK_LENGTH = 1000

/** Characters of a typed length. */
const MAX_TYPED = 7

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

/** Tools of the Draw tab in palette order; the number keys 1–9 pick them. */
const SHORTCUT_TOOLS: Tool[] = [
	'wall',
	'door',
	'sliding_door',
	'window',
	'stairs',
	'tray',
	'desk',
	'deskGroup',
	'room',
]

/** The number key of a tool, shown on its palette entry. */
function ToolKey(props: { tool: Tool }): JSX.Element {
	return <kbd class="drawn-plan-key">{SHORTCUT_TOOLS.indexOf(props.tool) + 1}</kbd>
}

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
	/** Length typed while drawing a wall, tray, stairs or room edge (cm), as typed. */
	const [typed, setTyped] = createSignal('')
	/** The desk a click would put down under the pointer. */
	const [quickGhost, setQuickGhost] = createSignal<{ a: Point; b: Point } | null>(null)
	const [deskLength, setDeskLength] = createSignal(DEFAULT_DESK_LENGTH)
	/** True while an object or handle is dragged; hides the selection's actions. */
	const [dragging, setDragging] = createSignal(false)
	/** Corners of the room being drawn. */
	const [roomDraft, setRoomDraft] = createSignal<Point[] | null>(null)
	/** Pointer on the sheet (cm), snapped while a tool draws. */
	const [hover, setHover] = createSignal<Point | null>(null)
	const [pointer, setPointer] = createSignal<Point | null>(null)
	const [snapMark, setSnapMark] = createSignal<Point | null>(null)
	/** Alignment guides of the point or object being placed. */
	const [guides, setGuides] = createSignal<Guide[]>([])
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
			boxes: [],
		}
	}

	const faces = createMemo(() => wallFaceTargets(walls()))

	/** Extents of the walls along a screen axis (diagonal walls' boxes would mislead), faces included. */
	const wallBoxes = createMemo((): Box[] => {
		const all = faces().faces
		return walls().flatMap((wall: EditWall, i: number): Box[] => {
			const [first, second] = [all[2 * i], all[2 * i + 1]]
			const straight =
				Math.abs(wall.a[0] - wall.b[0]) < SAME_JOINT ||
				Math.abs(wall.a[1] - wall.b[1]) < SAME_JOINT
			return straight && first && second ? [boxOf([...first, ...second])] : []
		})
	})

	/** Corners and edges of every object other things snap to, keyed like the selection. */
	const outlines = createMemo((): { key: string; points: Point[]; edges: [Point, Point][] }[] => [
		...stairs().map((stair: EditStair) => {
			const outline = stairShape(stair).outline
			return { key: `stair:${stair.id}`, points: outline, edges: ringEdges(outline) }
		}),
		...desks().map((desk: EditDesk) => {
			const outline = deskOutline(desk)
			return { key: `desk:${desk.id}`, points: outline, edges: ringEdges(outline) }
		}),
		...deskGroups().map((group: EditDeskGroup) => ({
			key: `deskGroup:${group.id}`,
			points: deskGroupCorners(group),
			edges: deskGroupEdges(group),
		})),
		...rooms().map((room: EditRoom) => ({
			key: `room:${room.id}`,
			points: room.points,
			edges: ringEdges(room.points),
		})),
	])

	/**
	 * What stairs, desks, desk groups and rooms snap to: the walls' faces and
	 * their corners, and the corners and edges of the other objects (not
	 * those keyed in `exclude`, which are being edited).
	 */
	function objectTargets(exclude: Set<string> = new Set()): SnapTargets {
		const { points, faces: lines } = faces()
		const others = outlines().filter((outline) => !exclude.has(outline.key))
		return {
			points: [...points, ...others.flatMap((outline) => outline.points)],
			lines: [
				...lines.map(([a, b]) => ({ a, b, reach: 0 })),
				...others.flatMap((outline) => outline.edges.map(([a, b]) => ({ a, b, reach: 0 }))),
			],
			boxes: [...wallBoxes(), ...others.map((outline) => boxOf(outline.points))],
		}
	}

	/** What a cable tray snaps to: the walls' faces and the other trays' ends and lines (not those in `exclude`). */
	function trayTargets(exclude: Set<number> = new Set()): SnapTargets {
		const { points, faces: lines } = faces()
		const others = trays().filter((tray: EditTray) => !exclude.has(tray.id))
		return {
			points: [...points, ...others.flatMap((tray: EditTray) => [tray.a, tray.b])],
			lines: [
				...lines.map(([a, b]) => ({ a, b, reach: 0 })),
				...others.map((tray: EditTray) => ({
					a: tray.a,
					b: tray.b,
					reach: tray.width / 2,
				})),
			],
			boxes: wallBoxes(),
		}
	}

	/** What a new object snaps to, while drawing it. */
	const allObjectTargets = createMemo(() => objectTargets())
	const allTrayTargets = createMemo(() => trayTargets())

	/** What a marker snaps to: the desks' and rooms' centers, and lines up with the other markers. */
	function markerTargets(exclude: number): SnapTargets {
		return {
			points: [
				...seats().map((seat: DeskSeat) => seat.at),
				...rooms().map((room: EditRoom) => polygonCenter(room.points)),
				...placements()
					.filter((p: FloorplanPlacementJson) => p.id !== exclude)
					.map((p: FloorplanPlacementJson): Point => [p.x, p.y]),
			],
			lines: [],
			boxes: [],
		}
	}

	/**
	 * A point at `raw` while snapping (Alt places it freely), drawn from a
	 * previous point `from` (Shift frees the angle): see `snapPoint`. Marks
	 * the point snapped to and shows the guides it lines up on.
	 */
	function snapTo(
		e: { altKey: boolean; shiftKey: boolean },
		raw: Point,
		from: Point | null,
		targets: SnapTargets,
	): Point {
		setSnapMark(null)
		setGuides([])
		if (!snapping(e)) {
			return raw
		}
		const { width, height } = sheet()
		const snapped = snapPoint(
			raw,
			e.shiftKey ? null : from,
			targets,
			snapRange(),
			SNAP_STEP,
			(p: Point) => clampPoint(p, width, height),
		)
		setSnapMark(snapped.mark)
		setGuides(snapped.guides)
		return snapped.value
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
	 * The move `delta` of a shape with `corners` and `edges`, snapped to
	 * `targets` while snapping: see `snapShift`. Marks the point snapped to
	 * and shows the guides it lines up on.
	 */
	function snapMove(
		e: { altKey: boolean },
		corners: Point[],
		edges: [Point, Point][],
		delta: Point,
		targets: SnapTargets,
	): Point {
		setSnapMark(null)
		setGuides([])
		if (!snapping(e)) {
			return delta
		}
		const snapped = snapShift(corners, edges, delta, targets, snapRange(), SNAP_STEP)
		setSnapMark(snapped.mark)
		setGuides(snapped.guides)
		return snapped.value
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
				setDragging(true)
			}
			move(stagePoint(ev), ev)
		}
		const onUp = (): void => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
			window.removeEventListener('pointercancel', onUp)
			setDragging(false)
			setSnapMark(null)
			setGuides([])
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
		// The walls joined to it follow, so they are no targets.
		const targets = wallTargets(new Set([...endsA, ...endsB].map((entry) => entry.id)))
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const [dx, dy] = keepOnSheet(
				[startA, startB],
				snapMove(
					ev,
					[startA, startB],
					[[startA, startB]],
					[at[0] - from[0], at[1] - from[1]],
					targets,
				),
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
		const outline = stairShape(stair).outline
		const targets = objectTargets(new Set([key]))
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const [dx, dy] = keepOnSheet(
				[a, b],
				snapMove(
					ev,
					outline,
					ringEdges(outline),
					[at[0] - from[0], at[1] - from[1]],
					targets,
				),
			)
			patchStair(id, { a: [a[0] + dx, a[1] + dy], b: [b[0] + dx, b[1] + dy] })
		})
	}

	function dragStairEnd(e: PointerEvent, stair: EditStair, end: 'a' | 'b'): void {
		const other = end === 'a' ? stair.b : stair.a
		const targets = objectTargets(new Set([`stair:${stair.id}`]))
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const to = snapTo(ev, at, other, targets)
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
		const targets = trayTargets(new Set([...endsA, ...endsB].map((entry) => entry.id)))
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const delta = keepOnSheet(
				[a, b],
				snapMove(ev, [a, b], [[a, b]], [at[0] - from[0], at[1] - from[1]], targets),
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
		const targets = trayTargets(new Set(ends.map((entry) => entry.id)))
		const other = end === 'a' ? tray.b : tray.a
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const to = snapTo(ev, at, other, targets)
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
		const targets = objectTargets(new Set([key]))
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const delta = keepOnSheet(
				[a, b],
				snapMove(
					ev,
					corners,
					ringEdges(corners),
					[at[0] - from[0], at[1] - from[1]],
					targets,
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
		const targets = objectTargets(new Set([`desk:${desk.id}`]))
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const to = snapTo(ev, at, other, targets)
			if (distance(to, other) >= MIN_WALL) {
				patchDesk(desk.id, { [end]: to })
			}
		})
	}

	/**
	 * Where a desk group `shape` put at `raw` goes: while snapping, it snaps
	 * to the other objects like a moved one (`targets`, without the group
	 * itself); it stays on the sheet.
	 */
	function groupCenter(
		e: { altKey: boolean },
		shape: NewDeskGroup,
		raw: Point,
		targets: SnapTargets,
	): Point {
		const group = { ...shape, center: raw }
		const corners = deskGroupCorners(group)
		const delta = keepOnSheet(
			corners,
			snapMove(e, corners, deskGroupEdges(group), [0, 0], targets),
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
		const targets = objectTargets(new Set([key]))
		startEdit(e, (at: Point, ev: PointerEvent) => {
			patchDeskGroup(id, {
				center: groupCenter(
					ev,
					group,
					[center[0] + at[0] - from[0], center[1] + at[1] - from[1]],
					targets,
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
		const targets = objectTargets(new Set([key]))
		const from = stagePoint(e)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const delta = keepOnSheet(
				start,
				snapMove(ev, start, ringEdges(start), [at[0] - from[0], at[1] - from[1]], targets),
			)
			patchRoom(id, {
				points: start.map((p: Point): Point => [p[0] + delta[0], p[1] + delta[1]]),
			})
		})
	}

	function dragRoomCorner(e: PointerEvent, room: EditRoom, index: number): void {
		const targets = objectTargets(new Set([`room:${room.id}`]))
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const to = snapTo(ev, at, null, targets)
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
		const start: Point = [placement.x, placement.y]
		const targets = markerTargets(placement.id)
		startEdit(e, (at: Point, ev: PointerEvent) => {
			const [dx, dy] = keepOnSheet(
				[start],
				snapMove(ev, [start], [], [at[0] - from[0], at[1] - from[1]], targets),
			)
			patchPlacement(placement.id, { x: start[0] + dx, y: start[1] + dy })
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
			center: groupCenter({ altKey: true }, next, next.center, allObjectTargets()),
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

	/** The points that place `current` on the sheet; the first one anchors it. */
	function selectionPoints(current: Selected): Point[] {
		const { kind, id } = current
		const find = <T extends { id: number }>(all: T[]): T | undefined =>
			all.find((x: T) => x.id === id)
		if (kind === 'wall' || kind === 'stair' || kind === 'tray' || kind === 'desk') {
			const line = find<EditWall | EditStair | EditTray | EditDesk>(
				kind === 'wall'
					? walls()
					: kind === 'stair'
						? stairs()
						: kind === 'tray'
							? trays()
							: desks(),
			)
			return line ? [line.a, line.b] : []
		}
		if (kind === 'opening') {
			const opening = find(openings())
			const wall = walls().find((w: EditWall) => w.id === opening?.wall_id)
			return opening && wall ? [along(wall.a, direction(wall.a, wall.b), opening.offset)] : []
		}
		if (kind === 'deskGroup') {
			const group = find(deskGroups())
			return group ? [group.center, ...deskGroupCorners(group)] : []
		}
		if (kind === 'room') {
			return find(rooms())?.points ?? []
		}
		const placement = placements().find((p: FloorplanPlacementJson) => p.id === id)
		return placement ? [[placement.x, placement.y]] : []
	}

	/** Moves `current` by `delta` (kept on the sheet); joined walls and trays follow, a door or window slides along its wall. */
	function translate(current: Selected, delta: Point): void {
		const points = selectionPoints(current)
		if (points.length === 0) {
			return
		}
		const { id } = current
		const [dx, dy] = current.kind === 'opening' ? delta : keepOnSheet(points, delta)
		const shift = (p: Point): Point => [p[0] + dx, p[1] + dy]
		if (current.kind === 'wall' || current.kind === 'tray') {
			const [a, b] = points as [Point, Point]
			const move = <T extends Run>(all: T[]): T[] =>
				movedRunEnds(
					movedRunEnds(all, runEndsAt(all, a), shift(a)),
					runEndsAt(all, b),
					shift(b),
				)
			if (current.kind === 'wall') {
				setWalls(move)
			} else {
				setTrays(move)
			}
		} else if (current.kind === 'opening') {
			const opening = openings().find((o: EditOpening) => o.id === id)
			const wall = walls().find((w: EditWall) => w.id === opening?.wall_id)
			if (opening && wall) {
				const u = direction(wall.a, wall.b)
				const offset = opening.offset + dx * u[0] + dy * u[1]
				patchOpening(id, { offset: clampOffset(wall, opening.width, offset) })
			}
		} else if (current.kind === 'stair') {
			const [a, b] = points as [Point, Point]
			patchStair(id, { a: shift(a), b: shift(b) })
		} else if (current.kind === 'desk') {
			const [a, b] = points as [Point, Point]
			patchDesk(id, { a: shift(a), b: shift(b) })
		} else if (current.kind === 'deskGroup') {
			patchDeskGroup(id, { center: shift(points[0] as Point) })
		} else if (current.kind === 'room') {
			patchRoom(id, { points: points.map(shift) })
		} else {
			const [x, y] = shift(points[0] as Point)
			patchPlacement(id, { x, y })
		}
	}

	/** The last nudge, so a held arrow key records one undo step. */
	let lastNudge = { key: '', at: 0 }

	/** Moves the selection with an arrow key: 10 cm, Shift 1 m, Alt 1 cm. */
	function nudge(e: KeyboardEvent): boolean {
		const current = selected()
		const unit: Point | undefined = (
			{
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0],
				ArrowUp: [0, -1],
				ArrowDown: [0, 1],
			} as Record<string, Point>
		)[e.key]
		// While a line is drawn the arrow keys are left alone; otherwise they move the selection in any tool.
		if (!current || !unit || drawFrom() !== null || lineStart() !== null) {
			return false
		}
		const by = e.altKey ? 1 : e.shiftKey ? 100 : SNAP_STEP
		const now = Date.now()
		if (lastNudge.key !== keyOf(current) || now - lastNudge.at > 1000) {
			checkpoint()
		}
		lastNudge = { key: keyOf(current), at: now }
		translate(current, [unit[0] * by, unit[1] * by])
		return true
	}

	/** The last duplicate, so the next one of the copy repeats the step between them. */
	let lastCopy: { source: Selected; copy: Selected } | null = null

	/**
	 * Where a duplicate goes, from the original: beside it (a desk along its
	 * back edge, a door or window along its wall, stairs across them, a
	 * wall or tray a meter across it, anything else its width to the
	 * right), or the step from the previous duplicate to this one.
	 */
	function copyOffset(current: Selected): Point {
		const points = selectionPoints(current)
		const previous = lastCopy
		if (previous && keyOf(previous.copy) === keyOf(current)) {
			const before = selectionPoints(previous.source)[0]
			const now = points[0]
			if (before && now && distance(before, now) >= MIN_WALL) {
				return [now[0] - before[0], now[1] - before[1]]
			}
		}
		const [a, b] = points as [Point, Point]
		if (current.kind === 'desk') {
			return [b[0] - a[0], b[1] - a[1]]
		}
		if (current.kind === 'opening') {
			const opening = openings().find((o: EditOpening) => o.id === current.id)
			const wall = walls().find((w: EditWall) => w.id === opening?.wall_id)
			const u = wall ? direction(wall.a, wall.b) : ([1, 0] as Point)
			const step = (opening?.width ?? 0) + SNAP_STEP * 5
			return [u[0] * step, u[1] * step]
		}
		if (current.kind === 'wall' || current.kind === 'tray' || current.kind === 'stair') {
			const u = direction(a, b)
			const across =
				current.kind === 'stair'
					? (stairs().find((x: EditStair) => x.id === current.id)?.width ?? 100)
					: 100
			return [u[1] * across, -u[0] * across]
		}
		const box = boxOf(points)
		return [box.x1 - box.x0, 0]
	}

	/** Duplicates the selection beside it (markers stand for one object each and are not copied) and selects the copy. */
	function duplicateSelected(): void {
		const current = selected()
		if (!current || current.kind === 'marker' || selectionPoints(current).length === 0) {
			return
		}
		const offset = copyOffset(current)
		const { id } = current
		const copyId = freshId()
		// Walls and trays are put in place directly (a nudge would drag the original's joints along).
		const [dx, dy] = keepOnSheet(selectionPoints(current), offset)
		const move = (p: Point): Point => [p[0] + dx, p[1] + dy]
		checkpoint()
		if (current.kind === 'wall') {
			const wall = walls().find((w: EditWall) => w.id === id) as EditWall
			setWalls((all: EditWall[]) => [
				...all,
				{ ...wall, id: copyId, a: move(wall.a), b: move(wall.b) },
			])
			setOpenings((all: EditOpening[]) => [
				...all,
				...all
					.filter((opening: EditOpening) => opening.wall_id === id)
					.map((opening: EditOpening) => ({
						...opening,
						id: freshId(),
						wall_id: copyId,
					})),
			])
		} else if (current.kind === 'opening') {
			const opening = openings().find((o: EditOpening) => o.id === id) as EditOpening
			setOpenings((all: EditOpening[]) => [...all, { ...opening, id: copyId }])
		} else if (current.kind === 'stair') {
			const stair = stairs().find((x: EditStair) => x.id === id) as EditStair
			setStairs((all: EditStair[]) => [...all, { ...stair, id: copyId }])
		} else if (current.kind === 'tray') {
			const tray = trays().find((x: EditTray) => x.id === id) as EditTray
			setTrays((all: EditTray[]) => [
				...all,
				{ ...tray, id: copyId, a: move(tray.a), b: move(tray.b) },
			])
		} else if (current.kind === 'desk') {
			// A location is linked to one desk: the copy starts unlinked.
			const { location_id: _, ...desk } = desks().find(
				(x: EditDesk) => x.id === id,
			) as EditDesk
			setDesks((all: EditDesk[]) => [...all, { ...desk, id: copyId }])
		} else if (current.kind === 'deskGroup') {
			const group = deskGroups().find((x: EditDeskGroup) => x.id === id) as EditDeskGroup
			setDeskGroups((all: EditDeskGroup[]) => [
				...all,
				{ ...group, id: copyId, location_ids: [null, null, null] },
			])
		} else if (current.kind === 'room') {
			const room = rooms().find((x: EditRoom) => x.id === id) as EditRoom
			setRooms((all: EditRoom[]) => [...all, { id: copyId, points: room.points }])
		}
		const copy: Selected = { kind: current.kind, id: copyId }
		// Stairs, desks, desk groups and rooms move into place like a nudge, kept on the sheet.
		if (current.kind !== 'wall' && current.kind !== 'tray') {
			translate(copy, offset)
		}
		setSelected(copy)
		lastCopy = { source: current, copy }
	}

	/** The outline of `current` on the sheet, for its box. */
	function selectionOutline(current: Selected): Point[] {
		const { kind, id } = current
		if (kind === 'stair') {
			const stair = stairs().find((x: EditStair) => x.id === id)
			return stair ? stairShape(stair).outline : []
		}
		if (kind === 'desk') {
			const desk = desks().find((x: EditDesk) => x.id === id)
			return desk ? deskOutline(desk) : []
		}
		if (kind === 'opening') {
			const opening = openings().find((o: EditOpening) => o.id === id)
			const wall = walls().find((w: EditWall) => w.id === opening?.wall_id)
			return opening && wall ? openingShape(wall, { ...opening, wall: 0 }).gap : []
		}
		return selectionPoints(current)
	}

	/** Whether the selection turns by 90° and flips (a window does not flip). */
	const canRotate = (current: Selected): boolean =>
		current.kind === 'desk' ||
		current.kind === 'deskGroup' ||
		current.kind === 'room' ||
		current.kind === 'stair'
	const canFlip = (current: Selected): boolean =>
		current.kind === 'desk' ||
		current.kind === 'stair' ||
		(current.kind === 'opening' && selectedOpening()?.kind !== 'window')

	/** Turns the selection 90° clockwise around its center, kept on the sheet. */
	function rotateSelected(): void {
		const current = selected()
		if (!current || !canRotate(current)) {
			return
		}
		const turn =
			(c: Point) =>
			(p: Point): Point => [c[0] - (p[1] - c[1]), c[1] + (p[0] - c[0])]
		const onSheet = (outline: Point[]): ((p: Point) => Point) => {
			const [dx, dy] = keepOnSheet(outline, [0, 0])
			return (p: Point): Point => [p[0] + dx, p[1] + dy]
		}
		const { id } = current
		checkpoint()
		if (current.kind === 'desk') {
			const desk = desks().find((x: EditDesk) => x.id === id) as EditDesk
			const r = turn(polygonCenter(deskOutline(desk)))
			const next = { ...desk, a: r(desk.a), b: r(desk.b) }
			const shift = onSheet(deskOutline(next))
			patchDesk(id, { a: shift(next.a), b: shift(next.b) })
		} else if (current.kind === 'stair') {
			const stair = stairs().find((x: EditStair) => x.id === id) as EditStair
			const r = turn([(stair.a[0] + stair.b[0]) / 2, (stair.a[1] + stair.b[1]) / 2])
			const next = { ...stair, a: r(stair.a), b: r(stair.b) }
			const shift = onSheet(stairShape(next).outline)
			patchStair(id, { a: shift(next.a), b: shift(next.b) })
		} else if (current.kind === 'room') {
			const room = rooms().find((x: EditRoom) => x.id === id) as EditRoom
			const turned = room.points.map(turn(polygonCenter(room.points)))
			patchRoom(id, { points: turned.map(onSheet(turned)) })
		} else {
			const group = deskGroups().find((x: EditDeskGroup) => x.id === id) as EditDeskGroup
			const next = { ...group, rotation: normalDegrees(group.rotation + 90) }
			patchDeskGroup(id, { ...next, center: onSheet(deskGroupCorners(next))(next.center) })
		}
	}

	/** Flips the selection: a desk to the other side of its back edge, stairs' direction, a door's swing side. */
	function flipSelected(): void {
		const current = selected()
		if (!current || !canFlip(current)) {
			return
		}
		const { id } = current
		checkpoint()
		if (current.kind === 'desk') {
			const desk = desks().find((x: EditDesk) => x.id === id) as EditDesk
			patchDesk(id, { a: desk.b, b: desk.a })
		} else if (current.kind === 'stair') {
			const stair = stairs().find((x: EditStair) => x.id === id) as EditStair
			patchStair(id, { a: stair.b, b: stair.a })
		} else {
			const opening = openings().find((o: EditOpening) => o.id === id) as EditOpening
			patchOpening(id, { side: opening.side === 'left' ? 'right' : 'left' })
		}
	}

	/** Title of the flip action of the selection. */
	function flipLabel(current: Selected): string {
		if (current.kind === 'desk') {
			return t('drawnPlan.flipDesk')
		}
		if (current.kind === 'stair') {
			return t('drawnPlan.flipStairs')
		}
		return t(
			selectedOpening()?.kind === 'sliding_door'
				? 'drawnPlan.flipSlideSide'
				: 'drawnPlan.flipSwing',
		)
	}

	/** Box of the selection the actions sit below; none for a marker, which has its own remove button. */
	const selectionBox = createMemo((): Box | null => {
		const current = selected()
		if (!current || current.kind === 'marker') {
			return null
		}
		const outline = selectionOutline(current)
		return outline.length > 0 ? boxOf(outline) : null
	})

	/**
	 * Distances to show for the selection: from a desk, desk group or stairs
	 * to the nearest object on each side (from the middle of each side of
	 * its box), from a door or window to what ends its stretch of wall (a
	 * crossing wall's face, another opening, or the wall's end).
	 */
	const dimensions = createMemo((): { a: Point; b: Point }[] => {
		const current = selected()
		if (!current) {
			return []
		}
		const keep = (a: Point, b: Point): { a: Point; b: Point }[] =>
			distance(a, b) >= 1 ? [{ a, b }] : []
		if (current.kind === 'opening') {
			const opening = selectedOpening()
			const wall = walls().find((w: EditWall) => w.id === opening?.wall_id)
			if (!opening || !wall) {
				return []
			}
			const length = wallLength(wall)
			const u = direction(wall.a, wall.b)
			const [from, to] = openingSpan(wall, { ...opening, wall: 0 })
			const crossing = faces().faces.map(([a, b]) => ({ a, b, reach: 0 }))
			const others = openings()
				.filter((o: EditOpening) => o.wall_id === wall.id && o.id !== opening.id)
				.map((o: EditOpening) => openingSpan(wall, { ...o, wall: 0 }))
			const ahead = rayHit(along(wall.a, u, to), u, crossing)
			const behind = rayHit(along(wall.a, u, from), [-u[0], -u[1]], crossing)
			const end = Math.min(
				length,
				ahead === null ? length : to + ahead,
				...others.filter(([f]) => f >= to).map(([f]) => f),
			)
			const start = Math.max(
				0,
				behind === null ? 0 : from - behind,
				...others.filter(([, e]) => e <= from).map(([, e]) => e),
			)
			return [
				...keep(along(wall.a, u, to), along(wall.a, u, end)),
				...keep(along(wall.a, u, from), along(wall.a, u, start)),
			]
		}
		if (current.kind !== 'desk' && current.kind !== 'deskGroup' && current.kind !== 'stair') {
			return []
		}
		const box = selectionBox()
		if (!box) {
			return []
		}
		const lines = objectTargets(new Set([keyOf(current)])).lines
		const [cx, cy] = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2]
		const rays: [Point, Point][] = [
			[
				[box.x0, cy],
				[-1, 0],
			],
			[
				[box.x1, cy],
				[1, 0],
			],
			[
				[cx, box.y0],
				[0, -1],
			],
			[
				[cx, box.y1],
				[0, 1],
			],
		]
		return rays.flatMap(([from, u]) => {
			const by = rayHit(from, u, lines)
			return by === null ? [] : keep(from, along(from, u, by))
		})
	})

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
		setTyped('')
		setQuickGhost(null)
		setHover(null)
		setSnapMark(null)
		setGuides([])
		setCalibration(null)
		setSequence(null)
		if (next !== 'select') {
			setSelected(null)
		}
	}

	/** Where the line being drawn starts: the chain's last corner, the stairs' foot or the room's last corner. */
	const drawFrom = (): Point | null => {
		const current = tool()
		if (current === 'wall' || current === 'tray') {
			return chain()?.last ?? null
		}
		if (current === 'stairs') {
			return lineStart()
		}
		if (current === 'room') {
			return roomDraft()?.at(-1) ?? null
		}
		return null
	}

	/** The typed length in cm, `null` while none (or none valid) is typed. */
	const typedLength = (): number | null => {
		const value = Number(typed().replace(',', '.'))
		return typed() !== '' && Number.isFinite(value) && value >= MIN_WALL ? value : null
	}

	/** End of the line being drawn: the typed length from its start toward the pointer, else the pointer. */
	const drawEnd = (): Point | null => {
		const from = drawFrom()
		const length = typedLength()
		const at = hover()
		if (!from || length === null) {
			return at
		}
		const u: Point = at && distance(from, at) > 0 ? direction(from, at) : [1, 0]
		const { width, height } = sheet()
		return clampPoint(along(from, u, length), width, height)
	}

	/** Puts down the next corner `at` (already snapped) of the wall, tray, stairs or room being drawn. */
	function placePoint(at: Point): void {
		setTyped('')
		switch (tool()) {
			case 'wall':
			case 'tray': {
				const current = chain()
				if (!current) {
					setChain({ first: at, last: at })
					return
				}
				if (distance(current.last, at) < MIN_WALL) {
					return
				}
				if (tool() === 'wall') {
					addWall(current.last, at)
				} else {
					addTray(current.last, at)
				}
				setChain(samePoint(at, current.first) ? null : { first: current.first, last: at })
				return
			}
			case 'stairs': {
				const start = lineStart()
				if (!start) {
					setLineStart(at)
				} else if (distance(start, at) >= MIN_WALL) {
					setLineStart(null)
					addStair(start, at)
				}
				return
			}
			case 'room': {
				const points = roomDraft() ?? []
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
		}
	}

	/**
	 * A desk `deskLength` long put down with one click at `at`: while
	 * snapping, with its back against the nearest wall face within its depth
	 * (on the face's open side), else level with its back edge below `at`;
	 * then snapped like a moved desk.
	 */
	function quickDesk(e: { altKey: boolean }, at: Point): { a: Point; b: Point } {
		const length = deskLength()
		const depth = deskDepth()
		let a: Point = [at[0] - length / 2, at[1] + depth / 2]
		let b: Point = [at[0] + length / 2, at[1] + depth / 2]
		if (snapping(e)) {
			let best: {
				face: [Point, Point]
				wall: EditWall
				point: Point
				distance: number
			} | null = null
			faces().faces.forEach((face: [Point, Point], index: number) => {
				const hit = projectOnSegment(at, face[0], face[1])
				// `wallFaceTargets` lists two faces per wall, in wall order.
				const wall = walls()[Math.floor(index / 2)]
				if (wall && hit.distance <= depth && (!best || hit.distance < best.distance)) {
					best = { face, wall, point: hit.point, distance: hit.distance }
				}
			})
			const found = best as { face: [Point, Point]; wall: EditWall; point: Point } | null
			if (found) {
				const u = direction(found.face[0], found.face[1])
				const center = projectOnSegment(found.point, found.wall.a, found.wall.b).point
				// The desk lies left of its back edge: run that edge so left points away from the wall.
				const away =
					(found.point[0] - center[0]) * u[1] - (found.point[1] - center[1]) * u[0] >= 0
				const v: Point = away ? u : [-u[0], -u[1]]
				a = along(found.point, v, -length / 2)
				b = along(found.point, v, length / 2)
			}
		}
		const corners = deskOutline({ a, b, depth })
		const [dx, dy] = keepOnSheet(
			corners,
			snapMove(e, corners, ringEdges(corners), [0, 0], allObjectTargets()),
		)
		return { a: [a[0] + dx, a[1] + dy], b: [b[0] + dx, b[1] + dy] }
	}

	/**
	 * Desk tool: a click puts a desk down (`quickDesk`); a drag draws its
	 * back edge from the press to the release.
	 */
	function pressDeskTool(e: PointerEvent, raw: Point): void {
		const start = snapTo(e, raw, null, allObjectTargets())
		const [x0, y0] = [e.clientX, e.clientY]
		setQuickGhost(null)
		setLineStart(start)
		const onUp = (ev: PointerEvent): void => {
			window.removeEventListener('pointerup', onUp)
			window.removeEventListener('pointercancel', onUp)
			setLineStart(null)
			if (ev.type === 'pointerup') {
				if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > DRAG_PX) {
					const end = snapTo(ev, stagePoint(ev), start, allObjectTargets())
					if (distance(start, end) >= MIN_WALL) {
						addDesk(start, end)
					}
				} else {
					const desk = quickDesk(ev, raw)
					addDesk(desk.a, desk.b)
				}
			}
			setSnapMark(null)
			setGuides([])
		}
		window.addEventListener('pointerup', onUp)
		window.addEventListener('pointercancel', onUp)
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
			case 'wall':
				placePoint(snapCorner(e, raw, chain()?.last ?? null))
				return
			case 'door':
			case 'sliding_door':
			case 'window':
				addOpening(tool() as OpeningKind, raw)
				return
			case 'stairs':
				placePoint(snapTo(e, raw, lineStart(), allObjectTargets()))
				return
			case 'desk':
				pressDeskTool(e, raw)
				return
			case 'deskGroup':
				addDeskGroup(groupCenter(e, newGroup(), raw, allObjectTargets()))
				return
			case 'tray':
				placePoint(snapTo(e, raw, chain()?.last ?? null, allTrayTargets()))
				return
			case 'room': {
				const points = roomDraft() ?? []
				placePoint(snapTo(e, raw, points[points.length - 1] ?? null, allObjectTargets()))
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
			setHover(snapTo(e, raw, lineStart(), allObjectTargets()))
		} else if (tool() === 'desk') {
			const start = lineStart()
			setHover(start ? snapTo(e, raw, start, allObjectTargets()) : raw)
			setQuickGhost(start ? null : quickDesk(e, raw))
		} else if (tool() === 'deskGroup') {
			setHover(groupCenter(e, newGroup(), raw, allObjectTargets()))
		} else if (tool() === 'tray') {
			setHover(snapTo(e, raw, chain()?.last ?? null, allTrayTargets()))
		} else if (tool() === 'room') {
			const points = roomDraft() ?? []
			setHover(snapTo(e, raw, points[points.length - 1] ?? null, allObjectTargets()))
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
		if (drawFrom() && !mod && !e.altKey) {
			// While drawing, digits type the next line's length instead of picking a tool.
			const decimal = (e.key === '.' || e.key === ',') && !/[.,]/.test(typed())
			if ((/^[0-9]$/.test(e.key) || decimal) && typed().length < MAX_TYPED) {
				e.preventDefault()
				setTyped(typed() + e.key)
				return
			}
			if (e.key === 'Backspace' && typed() !== '') {
				e.preventDefault()
				setTyped(typed().slice(0, -1))
				return
			}
			if (e.key === 'Escape' && typed() !== '') {
				e.preventDefault()
				setTyped('')
				return
			}
			const end = drawEnd()
			if (e.key === 'Enter' && typedLength() !== null && end) {
				e.preventDefault()
				placePoint(end)
				return
			}
		}
		if (e.key === 'Enter' && roomDraft()) {
			e.preventDefault()
			finishRoom()
			return
		}
		if (e.key === 'Escape' || e.key === 'Enter') {
			if (chain() || lineStart() || roomDraft() || calibration() || sequence() !== null) {
				e.preventDefault()
				setTyped('')
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
			return
		}
		if (mod && e.key.toLowerCase() === 'd') {
			e.preventDefault()
			duplicateSelected()
			return
		}
		if (nudge(e)) {
			e.preventDefault()
			return
		}
		const shortcut = SHORTCUT_TOOLS[Number(e.key) - 1]
		if (shortcut && !mod && !e.altKey) {
			e.preventDefault()
			setTab('draw')
			setTool(tool() === shortcut ? 'select' : shortcut)
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
		const at = drawEnd()
		return current && at && tool() === kind ? { a: current.last, b: at } : null
	}
	const draftWall = (): { a: Point; b: Point } | null => draftRun('wall')
	const draftTray = (): { a: Point; b: Point } | null => draftRun('tray')

	/** The stairs or desk being drawn: from their first end to the pointer. */
	const draftLine = (kind: 'stairs' | 'desk'): { a: Point; b: Point } | null => {
		const start = lineStart()
		const at = drawEnd()
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
		const at = drawEnd()
		return points && tool() === 'room' ? (at ? [...points, at] : points) : null
	}

	/** The room edge being drawn: from its last corner to the pointer. */
	const draftRoomEdge = (): { a: Point; b: Point } | null => {
		const from = tool() === 'room' ? drawFrom() : null
		const at = drawEnd()
		return from && at && distance(from, at) >= MIN_WALL ? { a: from, b: at } : null
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
											<ToolKey tool="wall" />
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
														<ToolKey tool={kind} />
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
											<ToolKey tool="stairs" />
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
														<ToolKey tool={value} />
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
										label={t('drawnPlan.length')}
										value={deskLength()}
										min={MIN_DESK_DEPTH}
										max={MAX_DESK_LENGTH}
										on_commit={setDeskLength}
									/>
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
								<Show
									when={draftDesk() ?? (tool() === 'desk' ? quickGhost() : null)}
								>
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
								<For each={dimensions()}>
									{(line: { a: Point; b: Point }) => (
										<line
											class="drawn-plan-dimension"
											x1={line.a[0]}
											y1={line.a[1]}
											x2={line.b[0]}
											y2={line.b[1]}
										/>
									)}
								</For>
								<For each={guides()}>
									{(guide: Guide) => (
										<line
											class="floorplan-guide"
											x1={guide.axis === 'x' ? guide.at : guide.from}
											x2={guide.axis === 'x' ? guide.at : guide.to}
											y1={guide.axis === 'x' ? guide.from : guide.at}
											y2={guide.axis === 'x' ? guide.to : guide.at}
										/>
									)}
								</For>
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
						<Show
							when={
								draftStair() ??
								draftDesk() ??
								draftTray() ??
								draftWall() ??
								draftRoomEdge()
							}
						>
							{(line: () => { a: Point; b: Point }) => (
								<span
									class="drawn-plan-label"
									classList={{ 'drawn-plan-label-typed': typed() !== '' }}
									style={toPercent(midpoint(line().a, line().b))}
								>
									{typed() !== ''
										? t('floorplan.centimeters', { value: typed() })
										: formatLength(distance(line().a, line().b))}
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
									setQuickGhost(null)
									setSnapMark(null)
									setGuides([])
								}}
								onDblClick={() => {
									setChain(null)
									if (tool() === 'room') {
										finishRoom()
									}
								}}
							/>
						</Show>
						<For each={dimensions()}>
							{(line: { a: Point; b: Point }) => (
								<span
									class="drawn-plan-label drawn-plan-label-dimension"
									style={toPercent(midpoint(line.a, line.b))}
								>
									{formatLength(distance(line.a, line.b))}
								</span>
							)}
						</For>
						<Show when={!dragging() && selected() && selectionBox()}>
							{(box: () => Box) => (
								<div
									class="drawn-plan-actions"
									role="toolbar"
									aria-label={t('drawnPlan.selectionActions')}
									style={toPercent([(box().x0 + box().x1) / 2, box().y1])}
									onPointerDown={(e: PointerEvent) => e.stopPropagation()}
								>
									<Show when={canRotate(selected() as Selected)}>
										<button
											type="button"
											class="drawn-plan-action"
											aria-label={t('drawnPlan.rotate')}
											title={t('drawnPlan.rotate')}
											onClick={rotateSelected}
										>
											<IconRotateClockwise size={14} />
										</button>
									</Show>
									<Show when={canFlip(selected() as Selected)}>
										<button
											type="button"
											class="drawn-plan-action"
											aria-label={flipLabel(selected() as Selected)}
											title={flipLabel(selected() as Selected)}
											onClick={flipSelected}
										>
											<IconFlipVertical size={14} />
										</button>
									</Show>
									<button
										type="button"
										class="drawn-plan-action"
										aria-label={t('drawnPlan.duplicate')}
										title={t('drawnPlan.duplicate')}
										onClick={duplicateSelected}
									>
										<IconCopy size={14} />
									</button>
									<button
										type="button"
										class="drawn-plan-action"
										aria-label={t('common.delete')}
										title={t('common.delete')}
										onClick={deleteSelected}
									>
										<IconTrash size={14} />
									</button>
								</div>
							)}
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
