/**
 * Edit mode of a drawn floor plan. Works on a draft copy and sends it with
 * one `PUT` on save; cancel discards it.
 *
 * - Select (default): click a wall, door, window or marker to select it,
 *   drag it to move it. A selected wall shows handles on its ends; walls
 *   joined at a moved end follow it. The inspector below the stage edits
 *   the selection (length, thickness, width, swing) and deletes it.
 * - Wall: each click adds a corner, chaining walls; clicking the chain's
 *   first corner closes it, a double click, Enter or Escape ends it.
 * - Door / window: a click on a wall puts one there.
 * - Snap (toggle; Alt skips it): points snap to wall ends, then onto walls,
 *   then to the grid. Shift keeps a wall at a multiple of 45°.
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
	IconDoor,
	IconMagnet,
	IconPhotoUp,
	IconRulerMeasure,
	IconWall,
	IconWindow,
	IconX,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import {
	MAX_DRAWING_CM,
	MAX_OPENING_WIDTH,
	MAX_WALL_THICKNESS,
	MIN_OPENING_WIDTH,
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
	type FloorplanDrawingJson,
	type FloorplanDrawingPut,
	type FloorplanOpening,
	type FloorplanWall,
	fetch_drawing_candidates,
	put_drawing,
} from '../api/floorplan_drawings'
import { t } from '../i18n'
import { createRows, createRowsFor, useAction } from '../lib/resource'
import { useLeaveGuard } from '../lib/router'
import { readStored, writeStored } from '../lib/storage'
import {
	along,
	clampPoint,
	constrainAngle,
	contentExtent,
	DEFAULT_OPENING_WIDTH,
	DEFAULT_WALL_THICKNESS,
	direction,
	distance,
	openingShape,
	openingSpan,
	type Point,
	projectOnSegment,
	roundTo,
	samePoint,
	snapToGrid,
	wallLength,
} from './drawn_plan_geometry'
import {
	DrawnPlanStage,
	formatLength,
	OpeningGlyph,
	percentOf,
	pxPerCm,
	referenceOpacity,
	type Sheet,
	type StageReference,
	type StageWall,
	setReferenceOpacity,
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

type Tool = 'select' | 'wall' | 'door' | 'window' | 'image' | 'calibrate'

/** Tabs of the side panel: drawing elements, adding objects, and the plan's sheet and image. */
type SideTab = 'draw' | 'add' | 'plan'

type SelectedKind = 'wall' | 'opening' | 'marker'

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
	const [placements, setPlacements] = createSignal<FloorplanPlacementJson[]>(
		props.drawing.placements,
	)
	const [selected, setSelected] = createSignal<Selected | null>(null)
	const [tool, setToolSignal] = createSignal<Tool>('select')
	const [thickness, setThickness] = createSignal(DEFAULT_WALL_THICKNESS)
	/** Corner the next wall of a chain starts at, and the chain's first corner. */
	const [chain, setChain] = createSignal<{ first: Point; last: Point } | null>(null)
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

	const snapshot = (): Snapshot => ({
		sheet: sheet(),
		reference: reference(),
		walls: walls(),
		openings: openings(),
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
		setPlacements(state.placements)
		const current = selected()
		const exists =
			current === null ||
			(current.kind === 'wall' && state.walls.some((w: EditWall) => w.id === current.id)) ||
			(current.kind === 'opening' &&
				state.openings.some((o: EditOpening) => o.id === current.id)) ||
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

	/**
	 * A wall corner at `raw`: snapped to a wall end, then onto a wall, then
	 * to the grid; with Shift at a multiple of 45° from `from`. Walls in
	 * `exclude` are no snap targets. Marks the point snapped to.
	 */
	function snapCorner(
		e: { altKey: boolean; shiftKey: boolean },
		raw: Point,
		from: Point | null,
		exclude: Set<number> = new Set(),
	): Point {
		setSnapMark(null)
		const { width, height } = sheet()
		if (!snapping(e)) {
			return from && e.shiftKey
				? clampPoint(constrainAngle(from, raw, 0), width, height)
				: raw
		}
		const range = snapRange()
		const targets = walls().filter((wall: EditWall) => !exclude.has(wall.id))
		let best: Point | null = null
		let bestDistance = range
		for (const wall of targets) {
			for (const end of [wall.a, wall.b]) {
				const d = distance(raw, end)
				if (d <= bestDistance) {
					best = end
					bestDistance = d
				}
			}
		}
		if (best) {
			setSnapMark(best)
			return best
		}
		if (from && e.shiftKey) {
			return clampPoint(constrainAngle(from, raw, gridStep()), width, height)
		}
		for (const wall of targets) {
			const hit = projectOnSegment(raw, wall.a, wall.b)
			if (
				hit.distance <= Math.max(range, wall.thickness / 2) &&
				hit.distance <= bestDistance + range
			) {
				setSnapMark(hit.point)
				return hit.point
			}
		}
		return clampPoint(snapToGrid(raw, gridStep()), width, height)
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
		return walls().flatMap((wall: EditWall) => [
			...(samePoint(wall.a, point) ? [{ id: wall.id, end: 'a' as const }] : []),
			...(samePoint(wall.b, point) ? [{ id: wall.id, end: 'b' as const }] : []),
		])
	}

	/** Moves the given wall ends to `to`. */
	function moveEnds(ends: { id: number; end: 'a' | 'b' }[], to: Point): void {
		setWalls((all: EditWall[]) =>
			all.map((wall: EditWall) => {
				const moved = ends.filter((entry) => entry.id === wall.id)
				if (moved.length === 0) {
					return wall
				}
				const next = { ...wall }
				for (const entry of moved) {
					next[entry.end] = to
				}
				return next
			}),
		)
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
				const snapped = snapToGrid([startA[0] + dx, startA[1] + dy], gridStep())
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
			const offset = snapping(ev) ? roundTo(hit.offset, gridStep()) : hit.offset
			patchOpening(id, { offset: clampOffset(wall, opening.width, offset) })
		})
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
				next = snapToGrid(next, gridStep())
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
				x = roundTo(x, gridStep())
				y = roundTo(y, gridStep())
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
		const offset = snapping({ altKey: false }) ? roundTo(hit.offset, gridStep()) : hit.offset
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
		const key = dragged()
		return key === 'opening:door' ? 'door' : key === 'opening:window' ? 'window' : null
	}

	function onDrop(e: DragEvent): void {
		e.preventDefault()
		const key = dragged() ?? e.dataTransfer?.getData('text/plain')
		setDragged(null)
		setHover(null)
		if (key === 'opening:door' || key === 'opening:window') {
			addOpening(key === 'opening:door' ? 'door' : 'window', stagePoint(e))
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
		const [x, y] = contentExtent(walls(), placements())
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
			case 'window':
				addOpening(tool() as OpeningKind, raw)
				return
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
	 * Second scale point: at a multiple of 45° from the first while snapping
	 * (Alt places it freely), so a scale along a wall in the image stays
	 * exactly horizontal or vertical.
	 */
	function scaleEnd(e: { altKey: boolean }, a: Point, raw: Point): Point {
		const { width, height } = sheet()
		return snapping(e) ? clampPoint(constrainAngle(a, raw, 0), width, height) : raw
	}

	function toolHover(e: PointerEvent): void {
		const raw = stagePoint(e)
		const first = calibration()?.a
		if (tool() === 'wall') {
			setHover(snapCorner(e, raw, chain()?.last ?? null))
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
		if ((kind !== 'door' && kind !== 'window') || !at) {
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
		if (e.key === 'Escape' || e.key === 'Enter') {
			if (chain() || calibration() || sequence() !== null) {
				e.preventDefault()
				setChain(null)
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

	/** The wall being drawn: from the chain's last corner to the pointer. */
	const draftWall = (): { a: Point; b: Point } | null => {
		const current = chain()
		const at = hover()
		return current && at && tool() === 'wall' ? { a: current.last, b: at } : null
	}

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
									<li>
										<button
											type="button"
											class="floorplan-palette-item drawn-plan-element"
											classList={{ active: tool() === 'door' }}
											aria-pressed={tool() === 'door'}
											title={t('drawnPlan.openingPlaceHint')}
											draggable="true"
											onDragStart={(e: DragEvent) => {
												e.dataTransfer?.setData(
													'text/plain',
													'opening:door',
												)
												setTool('select')
												setDragged('opening:door')
											}}
											onDragEnd={() => {
												setDragged(null)
												setHover(null)
											}}
											onClick={() =>
												setTool(tool() === 'door' ? 'select' : 'door')
											}
										>
											<IconDoor size={14} />
											<span>{t('drawnPlan.toolDoor')}</span>
										</button>
									</li>
									<li>
										<button
											type="button"
											class="floorplan-palette-item drawn-plan-element"
											classList={{ active: tool() === 'window' }}
											aria-pressed={tool() === 'window'}
											title={t('drawnPlan.openingPlaceHint')}
											draggable="true"
											onDragStart={(e: DragEvent) => {
												e.dataTransfer?.setData(
													'text/plain',
													'opening:window',
												)
												setTool('select')
												setDragged('opening:window')
											}}
											onDragEnd={() => {
												setDragged(null)
												setHover(null)
											}}
											onClick={() =>
												setTool(tool() === 'window' ? 'select' : 'window')
											}
										>
											<IconWindow size={14} />
											<span>{t('drawnPlan.toolWindow')}</span>
										</button>
									</li>
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
							<p class="floorplan-hint">
								<Switch fallback={t('drawnPlan.drawHint')}>
									<Match when={tool() === 'wall'}>
										{t(
											chain()
												? 'drawnPlan.wallNextHint'
												: 'drawnPlan.wallHint',
										)}
									</Match>
									<Match when={tool() === 'door' || tool() === 'window'}>
										{t('drawnPlan.openingHint')}
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
							<WallLayer
								walls={stageWalls()}
								selected={selected() ? keyOf(selected() as Selected) : null}
								on_wall_press={pressWall}
								on_opening_press={pressOpening}
							/>
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
						<Show when={draftWall()}>
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
								onDblClick={() => setChain(null)}
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
												checkpoint()
												patchOpening(opening().id, {
													kind:
														e.currentTarget.value === 'window'
															? 'window'
															: 'door',
												})
											}}
										>
											<option value="door">{t('drawnPlan.door')}</option>
											<option value="window">{t('drawnPlan.window')}</option>
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
									<Show when={opening().kind === 'door'}>
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
											{t('drawnPlan.flipHinge')}
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
											{t('drawnPlan.flipSwing')}
										</button>
									</Show>
									<button type="button" onClick={deleteSelected}>
										{t(
											opening().kind === 'door'
												? 'drawnPlan.deleteDoor'
												: 'drawnPlan.deleteWindow',
										)}
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
