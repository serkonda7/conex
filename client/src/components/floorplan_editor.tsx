/**
 * Edit mode of a floor plan. The editor works on a draft copy of the plan
 * and sends it with one `PUT /plan` on save; cancel discards it.
 *
 * - Area tool: drag on the stage to draw a rectangle (four points), or
 *   click corner by corner to draw a polygon (closed by clicking the first
 *   corner, a double click or Enter; Backspace drops the last corner,
 *   Escape the whole draft). Then pick its target site or location. Areas
 *   are selected by click, moved by dragging, reshaped with corner handles
 *   (a rectangle's neighbors follow), relabelled and deleted below the
 *   stage. Dragging an edge's midpoint handle inserts a corner there; a
 *   double click on a corner handle removes it.
 * - Palette: unplaced racks and devices, grouped by location, and the
 *   unplaced outlets (patch-panel rear ports) of the site, grouped by
 *   panel. Dragging an item onto the stage (HTML5 drag and drop) places a
 *   marker at the drop point; a click places it in the center. Markers move
 *   with pointer events and are removed with ×.
 * - Place in sequence: per panel, each click on the stage places the
 *   panel's next free outlet (Escape or the toggle ends it).
 * - On the plan: the object list (second tab of the side panel) selects,
 *   renames and deletes areas and markers; it shares the palette's search.
 * - Scale: click (or drag between) two points a known distance apart, then
 *   enter the distance in centimeters. The points stay as handles to adjust;
 *   the distance label reopens the dialog. Origin: a click sets the zero
 *   point of the coordinates, a handle moves it. Both are saved with the
 *   plan and drive the grid and the pointer readout.
 *
 * - Snap (toggle, on by default; Alt skips it for one drag): area corners
 *   snap to the corners and edges of the other areas, markers align with
 *   other markers and area centers along guide lines (`floorplan_snap`).
 *
 * Hidden layers are not drawn and so cannot be edited on the stage; placing
 * or selecting an object of one shows it again.
 *
 * All coordinates are clamped to 0..1.
 */
import {
	IconCurrentLocation,
	IconMagnet,
	IconPencilPlus,
	IconRulerMeasure,
	IconX,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import {
	createMemo,
	createSignal,
	For,
	Index,
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
	type FloorplanAreaJson,
	type FloorplanCandidateJson,
	type FloorplanJson,
	type FloorplanPlacementJson,
	type FloorplanPut,
	type FloorplanScale,
	fetch_floorplan_candidates,
	put_floorplan,
} from '../api/attachments'
import type { LocationType } from '../api/tenancy'
import { fetch_locations, fetch_sites } from '../api/tenancy'
import { t, tp } from '../i18n'
import { createRows, useAction } from '../lib/resource'
import { useLeaveGuard } from '../lib/router'
import { tenantContextFilters } from '../lib/tenant_context'
import { InlineError, Loading } from './feedback'
import { areaLayer, LayerBar, layerVisible, markerLayer, showLayer } from './floorplan_layers'
import { focusObject, ObjectList, type PlanObject } from './floorplan_objects'
import {
	alignPoint,
	type Guide,
	type Metric,
	snapEnabled,
	snapPoint,
	snapShift,
	toggleSnap,
} from './floorplan_snap'
import {
	areaCenter,
	areaName,
	FloorplanStage,
	formatCentimeters,
	MarkerGlyph,
	MarkerName,
	markerClasses,
	markerTitle,
	percent,
	pixelDistance,
	type StageZoom,
} from './floorplan_stage'
import { TextField } from './form'
import { IconLabel } from './icon_label'
import { Modal } from './modal'
import { ObjectSearch } from './object_selector'

type Point = [number, number]

/** Smallest side (fraction of the plan) of a drawn area's bounding box; smaller ones are discarded. */
const MIN_AREA_SIZE = 0.01

/** Most corners of an area (as `FloorplanPutSchema` allows). */
const MAX_AREA_POINTS = 100

/** Corners closer than this (fraction of the plan) count as the same one. */
const SAME_POINT = 0.002

/** Shortest distance (image px) between the two scale points. */
const MIN_SCALE_PX = 5

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value))
}

/** The four corners of the rectangle between two points. */
function rectPoints(a: Point, b: Point): Point[] {
	const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
	const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
	return [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1],
	]
}

/** True for four points forming an axis-aligned rectangle (the shape the tool draws). */
function isRect(points: Point[]): boolean {
	if (points.length !== 4) {
		return false
	}
	const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6
	const horizontalFirst = near(points[0][1], points[1][1]) && near(points[1][0], points[2][0])
	const verticalFirst = near(points[0][0], points[1][0]) && near(points[1][1], points[2][1])
	return (
		(horizontalFirst && near(points[2][1], points[3][1]) && near(points[3][0], points[0][0])) ||
		(verticalFirst && near(points[2][0], points[3][0]) && near(points[3][1], points[0][1]))
	)
}

/** `points` with corner `index` moved to `to`; the neighbors follow so a rectangle stays one. */
function moveCorner(points: Point[], index: number, to: Point): Point[] {
	const next = points.map((point: Point): Point => [point[0], point[1]])
	next[index] = to
	if (!isRect(points)) {
		return next
	}
	const after = (index + 1) % 4
	const before = (index + 3) % 4
	const afterSharesX = Math.abs(points[index][0] - points[after][0]) < 1e-6
	next[after] = afterSharesX ? [to[0], points[after][1]] : [points[after][0], to[1]]
	next[before] = afterSharesX ? [points[before][0], to[1]] : [to[0], points[before][1]]
	return next
}

/** True if the bounding box of `points` is large enough to keep as an area. */
function largeEnough(points: Point[]): boolean {
	const xs = points.map((point: Point) => point[0])
	const ys = points.map((point: Point) => point[1])
	return (
		points.length >= 3 &&
		Math.max(...xs) - Math.min(...xs) >= MIN_AREA_SIZE &&
		Math.max(...ys) - Math.min(...ys) >= MIN_AREA_SIZE
	)
}

function samePoint(a: Point, b: Point): boolean {
	return Math.abs(a[0] - b[0]) < SAME_POINT && Math.abs(a[1] - b[1]) < SAME_POINT
}

/** The midpoint of each edge; entry `i` lies between corner `i` and the next one. */
function edgeMidpoints(points: Point[]): Point[] {
	return points.map((point: Point, index: number): Point => {
		const next = points[(index + 1) % points.length]
		return [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]
	})
}

function svgPoints(points: Point[]): string {
	return points.map((point: Point) => point.join(',')).join(' ')
}

/** `points` shifted by the delta, limited so the bounding box stays on the plan. */
function shiftPoints(points: Point[], dx: number, dy: number): Point[] {
	const xs = points.map((point: Point) => point[0])
	const ys = points.map((point: Point) => point[1])
	const mx = Math.min(Math.max(dx, -Math.min(...xs)), 1 - Math.max(...xs))
	const my = Math.min(Math.max(dy, -Math.min(...ys)), 1 - Math.max(...ys))
	return points.map((point: Point): Point => [point[0] + mx, point[1] + my])
}

/** The wire form of a draft; also what "changed" is measured on. */
function toPut(
	areas: FloorplanAreaJson[],
	placements: FloorplanPlacementJson[],
	scale: FloorplanScale | null,
	origin: Point | null,
): FloorplanPut {
	return {
		scale,
		origin,
		areas: areas.map((area: FloorplanAreaJson) => ({
			...(area.site_id !== null
				? { site_id: area.site_id }
				: { location_id: area.location_id ?? undefined }),
			label: area.label?.trim() || null,
			points: area.points,
		})),
		placements: placements.map((placement: FloorplanPlacementJson) => ({
			...(placement.rack_id !== null
				? { rack_id: placement.rack_id }
				: placement.jack_id !== null
					? { jack_id: placement.jack_id }
					: placement.interface_id !== null
						? { interface_id: placement.interface_id }
						: { device_id: placement.device_id ?? undefined }),
			x: placement.x,
			y: placement.y,
		})),
	}
}

function candidateKey(candidate: {
	rack_id: number | null
	device_id: number | null
	interface_id: number | null
	jack_id: number | null
}): string {
	if (candidate.rack_id !== null) {
		return `rack:${candidate.rack_id}`
	}
	if (candidate.jack_id !== null) {
		return `jack:${candidate.jack_id}`
	}
	return candidate.interface_id !== null
		? `port:${candidate.interface_id}`
		: `device:${candidate.device_id}`
}

type TargetKind = 'site' | 'location'

interface AreaTarget {
	kind: TargetKind
	id: number
	name: string
	/** Location type of a location target, for its layer. */
	type: LocationType | null
}

interface TargetRow {
	id: number
	name: string
	type?: LocationType
}

/** Modal to pick the site or location a new area links to. */
function AreaTargetPicker(props: {
	attachment: AttachmentJson
	areas: FloorplanAreaJson[]
	on_select: (target: AreaTarget) => void
	on_close: () => void
}): JSX.Element {
	const [kind, setKind] = createSignal<TargetKind>('site')
	/** Not offered: the plan's owner and the targets of existing areas. */
	const taken = (id: number, kindOf: TargetKind): boolean =>
		(kindOf === 'site' ? props.attachment.site_id : props.attachment.location_id) === id ||
		props.areas.some(
			(area: FloorplanAreaJson) =>
				(kindOf === 'site' ? area.site_id : area.location_id) === id,
		)

	const load = async (search: string): Promise<Result<TargetRow[], Error>> => {
		const filters = { search, ...tenantContextFilters() }
		const res: Result<{ items: TargetRow[] }, Error> =
			kind() === 'site' ? await fetch_sites(filters) : await fetch_locations(filters)
		if (Result.isError(res)) {
			return Result.err(res.error)
		}
		return Result.ok(res.value.items.filter((row: { id: number }) => !taken(row.id, kind())))
	}

	return (
		<Modal
			title={t('floorplan.selectTarget')}
			class="object-selector"
			on_close={props.on_close}
		>
			<div class="floorplan-kinds">
				<For each={['site', 'location'] as const}>
					{(option: TargetKind) => (
						<button
							type="button"
							aria-pressed={kind() === option}
							classList={{ active: kind() === option }}
							onClick={() => setKind(option)}
						>
							{tp(`entity.${option}`, 1)}
						</button>
					)}
				</For>
			</div>
			{/* Keyed on the kind so the search restarts with the other list. */}
			<Switch>
				<For each={['site', 'location'] as const}>
					{(option: TargetKind) => (
						<Match when={kind() === option}>
							<ObjectSearch
								load={load}
								get_label={(row: { name: string }) => row.name}
								on_select={(row: TargetRow) =>
									props.on_select({
										kind: option,
										id: row.id,
										name: row.name,
										type: row.type ?? null,
									})
								}
							/>
						</Match>
					)}
				</For>
			</Switch>
		</Modal>
	)
}

/** Modal asking the real distance between the two scale points. */
function ScaleDistanceDialog(props: {
	centimeters: number | null
	on_save: (centimeters: number) => void
	on_close: () => void
}): JSX.Element {
	const [value, setValue] = createSignal(
		props.centimeters === null ? '' : String(props.centimeters),
	)
	const parsed = (): number => Number(value())
	const valid = (): boolean =>
		/^\d+$/.test(value().trim()) && parsed() >= 1 && parsed() <= 10_000_000
	return (
		<Modal title={t('floorplan.scaleTitle')} on_close={props.on_close}>
			<form
				class="form-stacked"
				onSubmit={(e: SubmitEvent) => {
					e.preventDefault()
					if (valid()) {
						props.on_save(parsed())
					}
				}}
			>
				<TextField
					id="floorplan-scale-centimeters"
					label={t('floorplan.scaleDistance')}
					value={value()}
					onInput={setValue}
					inputmode="numeric"
					hint={t('floorplan.scaleDistanceHint')}
					required
					autofocus
				/>
				<div class="modal-actions">
					<button type="button" onClick={props.on_close}>
						{t('common.cancel')}
					</button>
					<button type="submit" disabled={!valid()}>
						{t('common.save')}
					</button>
				</div>
			</form>
		</Modal>
	)
}

/** Calibration tool active on the stage. */
type CalibrationTool = 'scale' | 'origin'

interface PaletteGroup {
	name: string
	items: FloorplanCandidateJson[]
	/** Panel of an outlet group, for the sequence toggle; `null` for a location group. */
	panel_id: number | null
}

/**
 * Palette tab of the side panel: the unplaced racks and devices, grouped by
 * location, and the unplaced outlets, grouped by panel (in port order) with
 * a sequence toggle each, filtered by `search`.
 */
function Palette(props: {
	search: string
	candidates: FloorplanCandidateJson[] | undefined
	loading: boolean
	placed: Set<string>
	/** Panel whose outlets the stage places in sequence, if any. */
	sequence: number | null
	on_sequence: (panelId: number | null) => void
	on_drag: (key: string | null) => void
	on_place: (candidate: FloorplanCandidateJson) => void
}): JSX.Element {
	const groups = createMemo(() => {
		const needle = props.search.trim().toLowerCase()
		const byGroup = new Map<string, PaletteGroup>()
		for (const candidate of props.candidates ?? []) {
			if (props.placed.has(candidateKey(candidate))) {
				continue
			}
			const port = candidate.port
			const name = port
				? t('floorplan.outletsOf', { name: port.device_name })
				: (candidate.location_name ?? t('floorplan.noLocation'))
			if (
				needle &&
				!candidate.name.toLowerCase().includes(needle) &&
				!name.toLowerCase().includes(needle)
			) {
				continue
			}
			const key = port ? `port:${port.device_id}` : `location:${name}`
			const group = byGroup.get(key) ?? { name, items: [], panel_id: port?.device_id ?? null }
			group.items.push(candidate)
			byGroup.set(key, group)
		}
		// Outlets keep their port order (the server's); the rest sorts by name.
		return [...byGroup.values()]
			.map((group: PaletteGroup) => ({
				...group,
				items:
					group.panel_id === null
						? group.items.sort((a, b) => a.name.localeCompare(b.name))
						: group.items,
			}))
			.sort(
				(a, b) =>
					Number(a.panel_id !== null) - Number(b.panel_id !== null) ||
					a.name.localeCompare(b.name),
			)
	})

	return (
		<Show when={!props.loading} fallback={<Loading message={t('common.loading')} />}>
			<Show
				when={groups().length > 0}
				fallback={<p class="floorplan-hint">{t('floorplan.paletteEmpty')}</p>}
			>
				<For each={groups()}>
					{(group: PaletteGroup) => (
						<section>
							<div class="floorplan-palette-group-header">
								<h5>{group.name}</h5>
								<Show when={group.panel_id}>
									{(panelId: () => number) => (
										<button
											type="button"
											class="floorplan-palette-sequence"
											classList={{ active: props.sequence === panelId() }}
											aria-pressed={props.sequence === panelId()}
											title={t('floorplan.sequenceHint')}
											onClick={() =>
												props.on_sequence(
													props.sequence === panelId() ? null : panelId(),
												)
											}
										>
											{t('floorplan.sequence')}
										</button>
									)}
								</Show>
							</div>
							<ul>
								<For each={group.items}>
									{(candidate: FloorplanCandidateJson) => (
										<li>
											<button
												type="button"
												class="floorplan-palette-item"
												draggable="true"
												title={t('floorplan.placeHint')}
												onDragStart={(e: DragEvent) => {
													e.dataTransfer?.setData(
														'text/plain',
														candidateKey(candidate),
													)
													props.on_drag(candidateKey(candidate))
												}}
												onDragEnd={() => props.on_drag(null)}
												onClick={() => props.on_place(candidate)}
											>
												<MarkerGlyph placement={candidate} size={14} />
												<span>{candidate.name}</span>
											</button>
										</li>
									)}
								</For>
							</ul>
						</section>
					)}
				</For>
			</Show>
		</Show>
	)
}

type SideTab = 'palette' | 'objects'

/** Edit mode of one floor plan; replaces the view until saved or cancelled. */
export function FloorplanEditor(props: {
	attachment: AttachmentJson
	plan: FloorplanJson
	/** Zoom and pan, shared with the view so switching modes keeps them. */
	zoom: StageZoom
	on_saved: (plan: FloorplanJson) => void
	on_cancel: () => void
	/** Page header slot the Cancel / Save buttons render into, in place of the Edit button. */
	actions_mount: HTMLElement | undefined
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [areas, setAreas] = createSignal<FloorplanAreaJson[]>(props.plan.areas)
	const [placements, setPlacements] = createSignal<FloorplanPlacementJson[]>(
		props.plan.placements,
	)
	const [selected, setSelected] = createSignal<number | null>(null)
	const [selectedMarker, setSelectedMarker] = createSignal<number | null>(null)
	const [tab, setTab] = createSignal<SideTab>('palette')
	const [search, setSearch] = createSignal('')
	const zoom = props.zoom
	const [drawing, setDrawing] = createSignal(false)
	/** Area being drawn (rectangle or polygon corners), then held while its target is picked. */
	const [draft, setDraft] = createSignal<Point[] | null>(null)
	/** Pointer position over the plan while drawing a polygon, for the next edge's preview. */
	const [hover, setHover] = createSignal<Point | null>(null)
	const [picking, setPicking] = createSignal(false)
	const [dragged, setDragged] = createSignal<string | null>(null)
	/** Panel whose next free outlet a click on the stage places. */
	const [sequence, setSequence] = createSignal<number | null>(null)
	const [stage, setStage] = createSignal<HTMLDivElement>()
	const [planScale, setScale] = createSignal<FloorplanScale | null>(props.plan.scale)
	const [planOrigin, setOrigin] = createSignal<Point | null>(props.plan.origin)
	const [tool, setTool] = createSignal<CalibrationTool | null>(null)
	/** Scale points being picked: the first one, then the second while the pointer moves. */
	const [scaleDraft, setScaleDraft] = createSignal<{ a: Point; b: Point | null } | null>(null)
	/** Scale points awaiting their distance in the dialog. */
	const [askDistance, setAskDistance] = createSignal<{ a: Point; b: Point } | null>(null)
	/** Alignment guides of the marker being dragged. */
	const [guides, setGuides] = createSignal<Guide[]>([])
	/** Point an area corner or edge snapped to, while drawing or dragging. */
	const [snapMark, setSnapMark] = createSignal<Point | null>(null)
	const [candidates] = createRows(() => fetch_floorplan_candidates(props.attachment.id), setError)
	const save = useAction(setError)

	// Items added in the editor have no id yet: negative ones never clash.
	let nextId = -1

	const initial = JSON.stringify(
		toPut(props.plan.areas, props.plan.placements, props.plan.scale, props.plan.origin),
	)
	const dirty = createMemo(
		() => JSON.stringify(toPut(areas(), placements(), planScale(), planOrigin())) !== initial,
	)

	const placed = createMemo(
		() =>
			new Set(
				placements().map((placement: FloorplanPlacementJson) => candidateKey(placement)),
			),
	)
	const selectedArea = createMemo(() =>
		areas().find(
			(area: FloorplanAreaJson) => area.id === selected() && layerVisible(areaLayer(area)),
		),
	)
	const shownAreas = (): FloorplanAreaJson[] =>
		areas().filter((area: FloorplanAreaJson) => layerVisible(areaLayer(area)))
	const shownPlacements = (): FloorplanPlacementJson[] =>
		placements().filter((p: FloorplanPlacementJson) => layerVisible(markerLayer(p)))
	const selectedObject = (): PlanObject | null => {
		const area = selected()
		if (area !== null) {
			return { kind: 'area', id: area }
		}
		const marker = selectedMarker()
		return marker !== null ? { kind: 'marker', id: marker } : null
	}

	function selectObject(object: PlanObject): void {
		setSelected(object.kind === 'area' ? object.id : null)
		setSelectedMarker(object.kind === 'marker' ? object.id : null)
		focusObject(zoom, object, areas(), placements())
	}

	// The browser asks before a reload or tab close would drop the draft.
	const warnUnload = (e: BeforeUnloadEvent): void => {
		if (dirty()) {
			e.preventDefault()
		}
	}
	onMount(() => window.addEventListener('beforeunload', warnUnload))
	onCleanup(() => window.removeEventListener('beforeunload', warnUnload))
	// In-app navigation, Back / Forward and closing the tab ask as well.
	useLeaveGuard(dirty, () => t('floorplan.confirmCancel'))

	/** Position of a pointer event on the plan, clamped to 0..1. */
	function stagePoint(e: { clientX: number; clientY: number }): Point {
		const box = stage()?.getBoundingClientRect()
		if (!box || box.width === 0 || box.height === 0) {
			return [0, 0]
		}
		return [
			clamp01((e.clientX - box.left) / box.width),
			clamp01((e.clientY - box.top) / box.height),
		]
	}

	/** Screen px per plan unit at the current zoom. */
	function metric(): Metric {
		const { width, height } = zoom.size()
		return { sx: width * zoom.scale(), sy: height * zoom.scale() }
	}

	/** True when a pointer event should snap: snapping is on and Alt is not held. */
	function snapping(e: { altKey: boolean }): boolean {
		return snapEnabled() && !e.altKey
	}

	/** Corners of the shown areas other than `exclude`, as snap targets. */
	function snapPolygons(exclude: number | null = null): Point[][] {
		return shownAreas()
			.filter((area: FloorplanAreaJson) => area.id !== exclude)
			.map((area: FloorplanAreaJson) => area.points)
	}

	/** `at` snapped onto the other areas while snapping, marking the snap point. */
	function snapped(e: { altKey: boolean }, at: Point, exclude: number | null = null): Point {
		const to = snapping(e) ? snapPoint(metric(), at, snapPolygons(exclude)) : null
		setSnapMark(to)
		return to ?? at
	}

	/**
	 * Starts a pointer drag: `move` gets the distance from the start in plan
	 * coordinates (and the event) until the button is released.
	 */
	function startDrag(
		e: PointerEvent,
		move: (dx: number, dy: number, ev: PointerEvent) => void,
		end?: () => void,
	): void {
		e.preventDefault()
		e.stopPropagation()
		const start = stagePoint(e)
		const onMove = (ev: PointerEvent): void => {
			const at = stagePoint(ev)
			move(at[0] - start[0], at[1] - start[1], ev)
		}
		const onUp = (): void => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
			window.removeEventListener('pointercancel', onUp)
			setGuides([])
			setSnapMark(null)
			end?.()
		}
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		window.addEventListener('pointercancel', onUp)
	}

	function patchArea(id: number, patch: Partial<FloorplanAreaJson>): void {
		setAreas((all: FloorplanAreaJson[]) =>
			all.map((area: FloorplanAreaJson) => (area.id === id ? { ...area, ...patch } : area)),
		)
	}

	function patchPlacement(id: number, patch: Partial<FloorplanPlacementJson>): void {
		setPlacements((all: FloorplanPlacementJson[]) =>
			all.map((p: FloorplanPlacementJson) => (p.id === id ? { ...p, ...patch } : p)),
		)
	}

	function dragArea(e: PointerEvent, area: FloorplanAreaJson): void {
		setSelected(area.id)
		setSelectedMarker(null)
		const origin = area.points
		startDrag(e, (dx: number, dy: number, ev: PointerEvent) => {
			const shift = snapping(ev)
				? snapShift(metric(), origin, dx, dy, snapPolygons(area.id))
				: { dx, dy, at: null }
			setSnapMark(shift.at)
			patchArea(area.id, { points: shiftPoints(origin, shift.dx, shift.dy) })
		})
	}

	function dragCorner(e: PointerEvent, area: FloorplanAreaJson, index: number): void {
		const origin = area.points
		startDrag(e, (dx: number, dy: number, ev: PointerEvent) =>
			patchArea(area.id, {
				points: moveCorner(
					origin,
					index,
					snapped(
						ev,
						[clamp01(origin[index][0] + dx), clamp01(origin[index][1] + dy)],
						area.id,
					),
				),
			}),
		)
	}

	/** Inserts a corner in the middle of edge `index` and drags it. */
	function dragMidpoint(e: PointerEvent, area: FloorplanAreaJson, index: number): void {
		if (area.points.length >= MAX_AREA_POINTS) {
			e.preventDefault()
			e.stopPropagation()
			return
		}
		const origin = [...area.points]
		origin.splice(index + 1, 0, edgeMidpoints(area.points)[index])
		patchArea(area.id, { points: origin })
		dragCorner(e, { ...area, points: origin }, index + 1)
	}

	function removeCorner(area: FloorplanAreaJson, index: number): void {
		if (area.points.length > 3) {
			patchArea(area.id, {
				points: area.points.filter((_point: Point, i: number) => i !== index),
			})
		}
	}

	function dragMarker(e: PointerEvent, placement: FloorplanPlacementJson): void {
		setSelected(null)
		setSelectedMarker(placement.id)
		const [x, y] = [placement.x, placement.y]
		// Other markers and the area centers, as they stand when the drag starts.
		const targets: Point[] = [
			...shownPlacements()
				.filter((p: FloorplanPlacementJson) => p.id !== placement.id)
				.map((p: FloorplanPlacementJson): Point => [p.x, p.y]),
			...shownAreas().map((area: FloorplanAreaJson): Point => {
				const center = areaCenter(area)
				return [center.x, center.y]
			}),
		]
		startDrag(e, (dx: number, dy: number, ev: PointerEvent) => {
			const at: Point = [clamp01(x + dx), clamp01(y + dy)]
			const aligned = snapping(ev)
				? alignPoint(metric(), at, targets)
				: { point: at, guides: [] }
			setGuides(aligned.guides)
			patchPlacement(placement.id, { x: aligned.point[0], y: aligned.point[1] })
		})
	}

	/** True while a rectangle is dragged out; a draft otherwise is a polygon in progress. */
	const [rectDragging, setRectDragging] = createSignal(false)

	function toggleDrawing(on: boolean): void {
		setSequence(null)
		setTool(null)
		setScaleDraft(null)
		setDrawing(on)
		setDraft(null)
		setHover(null)
	}

	/**
	 * Pointer down on the draw layer: adds a corner to a polygon in progress.
	 * Otherwise a drag draws a rectangle and a click starts a polygon.
	 */
	function drawStart(e: PointerEvent): void {
		if (draft() !== null) {
			addPolygonPoint(e)
			return
		}
		const pressed = stagePoint(e)
		const from = snapped(e, pressed)
		startDrag(
			e,
			(dx: number, dy: number, ev: PointerEvent) => {
				if (
					!rectDragging() &&
					Math.abs(dx) < MIN_AREA_SIZE &&
					Math.abs(dy) < MIN_AREA_SIZE
				) {
					return
				}
				setRectDragging(true)
				setHover(null)
				setDraft(
					rectPoints(
						from,
						snapped(ev, [clamp01(pressed[0] + dx), clamp01(pressed[1] + dy)]),
					),
				)
			},
			() => {
				if (!rectDragging()) {
					setDraft([from])
					return
				}
				setRectDragging(false)
				const drawn = draft()
				setDrawing(false)
				if (drawn && largeEnough(drawn)) {
					setPicking(true)
				} else {
					setDraft(null)
				}
			},
		)
	}

	function addPolygonPoint(e: PointerEvent): void {
		e.preventDefault()
		e.stopPropagation()
		const at = snapped(e, stagePoint(e))
		setSnapMark(null)
		const points = draft() ?? []
		// The second click of a double click lands on the corner just added.
		if (points.length > 0 && samePoint(points[points.length - 1], at)) {
			return
		}
		if (points.length >= 3 && samePoint(points[0], at)) {
			finishPolygon()
			return
		}
		if (points.length < MAX_AREA_POINTS) {
			setDraft([...points, at])
		}
	}

	function finishPolygon(): void {
		const drawn = draft()
		if (!drawn || !largeEnough(drawn)) {
			return
		}
		setDrawing(false)
		setHover(null)
		setPicking(true)
	}

	// Keys of the area tool; ignored while typing in a field.
	const onKeyDown = (e: KeyboardEvent): void => {
		if (tool() !== null && e.key === 'Escape' && askDistance() === null) {
			e.preventDefault()
			selectTool(null)
			return
		}
		if (sequence() !== null && e.key === 'Escape') {
			e.preventDefault()
			setSequence(null)
			return
		}
		if (!drawing() || rectDragging() || picking() || e.target instanceof HTMLInputElement) {
			return
		}
		const points = draft() ?? []
		if (e.key === 'Enter') {
			e.preventDefault()
			finishPolygon()
		} else if (e.key === 'Escape') {
			e.preventDefault()
			toggleDrawing(points.length > 0)
		} else if (e.key === 'Backspace' && points.length > 0) {
			e.preventDefault()
			setDraft(points.length > 1 ? points.slice(0, -1) : null)
		}
	}
	onMount(() => window.addEventListener('keydown', onKeyDown))
	onCleanup(() => window.removeEventListener('keydown', onKeyDown))

	/** The draft as drawn so far, with the polygon's next edge to the pointer. */
	const draftPreview = createMemo((): Point[] | null => {
		const points = draft()
		const at = hover()
		return points && drawing() && at ? [...points, at] : points
	})

	function closePicker(): void {
		setPicking(false)
		setDraft(null)
	}

	function addArea(target: AreaTarget): void {
		const points = draft()
		closePicker()
		if (!points) {
			return
		}
		const id = nextId--
		setAreas((all: FloorplanAreaJson[]) => [
			...all,
			{
				id,
				site_id: target.kind === 'site' ? target.id : null,
				location_id: target.kind === 'location' ? target.id : null,
				label: null,
				points,
				target_name: target.name,
				target_type: target.type,
				target_plan_id: null,
			},
		])
		showLayer(
			areaLayer({
				site_id: target.kind === 'site' ? target.id : null,
				target_type: target.type,
			}),
		)
		setSelected(id)
	}

	function deleteArea(id: number): void {
		setAreas((all: FloorplanAreaJson[]) =>
			all.filter((area: FloorplanAreaJson) => area.id !== id),
		)
		setSelected(null)
	}

	function removeMarker(id: number): void {
		setPlacements((all: FloorplanPlacementJson[]) =>
			all.filter((p: FloorplanPlacementJson) => p.id !== id),
		)
		if (selectedMarker() === id) {
			setSelectedMarker(null)
		}
	}

	function addPlacement(candidate: FloorplanCandidateJson, at: Point): void {
		if (placed().has(candidateKey(candidate))) {
			return
		}
		showLayer(markerLayer(candidate))
		setPlacements((all: FloorplanPlacementJson[]) => [
			...all,
			{
				id: nextId--,
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
	}

	/** Free outlets of a panel in port order. */
	function freeOutlets(panelId: number): FloorplanCandidateJson[] {
		return (candidates() ?? []).filter(
			(item: FloorplanCandidateJson) =>
				item.port?.device_id === panelId && !placed().has(candidateKey(item)),
		)
	}

	function selectTool(next: CalibrationTool | null): void {
		toggleDrawing(false)
		setTool(next)
	}

	/** True if the scale points lie far enough apart on the image. */
	function scaleSpan(a: Point, b: Point): boolean {
		return pixelDistance(props.attachment, a, b) >= MIN_SCALE_PX
	}

	/**
	 * Pointer down while a tool is active: the origin tool sets the origin;
	 * the scale tool takes a first point (a drag ends on the second) or the
	 * second one, then asks the distance.
	 */
	function calibrateStart(e: PointerEvent): void {
		e.preventDefault()
		e.stopPropagation()
		const at = stagePoint(e)
		if (tool() === 'origin') {
			setOrigin(at)
			setTool(null)
			return
		}
		const first = scaleDraft()?.a
		if (first) {
			if (scaleSpan(first, at)) {
				setScaleDraft(null)
				setTool(null)
				setAskDistance({ a: first, b: at })
			}
			return
		}
		setScaleDraft({ a: at, b: null })
		startDrag(
			e,
			(dx: number, dy: number) =>
				setScaleDraft({ a: at, b: [clamp01(at[0] + dx), clamp01(at[1] + dy)] }),
			() => {
				const b = scaleDraft()?.b
				if (b && scaleSpan(at, b)) {
					setScaleDraft(null)
					setTool(null)
					setAskDistance({ a: at, b })
				} else {
					setScaleDraft({ a: at, b: null })
				}
			},
		)
	}

	function saveDistance(centimeters: number): void {
		const points = askDistance()
		setAskDistance(null)
		if (points) {
			setScale({ ...points, centimeters })
		}
	}

	/** Drags scale point `end`; the distance stays. */
	function dragScalePoint(e: PointerEvent, end: 'a' | 'b'): void {
		const current = planScale()
		if (!current) {
			return
		}
		const from = current[end]
		const other = end === 'a' ? current.b : current.a
		startDrag(e, (dx: number, dy: number) => {
			const to: Point = [clamp01(from[0] + dx), clamp01(from[1] + dy)]
			if (scaleSpan(to, other)) {
				setScale({ ...current, [end]: to })
			}
		})
	}

	function dragOrigin(e: PointerEvent): void {
		const from = planOrigin()
		if (from) {
			startDrag(e, (dx: number, dy: number) =>
				setOrigin([clamp01(from[0] + dx), clamp01(from[1] + dy)]),
			)
		}
	}

	/** The scale line as drawn: the saved one, or the one being picked (to the pointer). */
	const scaleLine = (): { a: Point; b: Point } | null => {
		const pending = scaleDraft()
		if (pending) {
			const b = pending.b ?? hover()
			return b ? { a: pending.a, b } : null
		}
		return planScale()
	}

	function startSequence(panelId: number | null): void {
		toggleDrawing(false)
		if (panelId !== null) {
			showLayer('marker-outlet')
		}
		setSequence(panelId)
	}

	/** Places the sequence panel's next free outlet at the pointer; ends with the last one. */
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

	function onDrop(e: DragEvent): void {
		e.preventDefault()
		const key = dragged() ?? e.dataTransfer?.getData('text/plain')
		setDragged(null)
		const candidate = candidates()?.find(
			(item: FloorplanCandidateJson) => candidateKey(item) === key,
		)
		if (candidate) {
			addPlacement(candidate, stagePoint(e))
		}
	}

	async function onSave(): Promise<void> {
		let saved: FloorplanJson | undefined
		const ok = await save.run(async () => {
			const res = await put_floorplan(
				props.attachment.id,
				toPut(areas(), placements(), planScale(), planOrigin()),
			)
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

	return (
		<div class="floorplan-editor">
			<Show when={props.actions_mount}>
				{(mount: () => HTMLElement) => (
					<Portal mount={mount()}>
						<div class="modal-actions">
							<button type="button" onClick={onCancel} disabled={save.pending()}>
								{t('common.cancel')}
							</button>
							<button
								type="submit"
								onClick={() => void onSave()}
								disabled={save.pending() || !dirty()}
							>
								{save.pending() ? t('common.saving') : t('common.save')}
							</button>
						</div>
					</Portal>
				)}
			</Show>
			<InlineError message={error()} />
			<div class="floorplan-layout">
				<div>
					<LayerBar
						areas={areas()}
						placements={placements()}
						has_scale={planScale() !== null}
					/>
					<FloorplanStage
						attachment={props.attachment}
						zoom={zoom}
						calibration={{ scale: planScale(), origin: planOrigin() }}
						ref={setStage}
						handlers={{
							onPointerDown: () => {
								setSelected(null)
								setSelectedMarker(null)
							},
							onDragOver: (e: DragEvent) => {
								if (dragged() !== null) {
									e.preventDefault()
								}
							},
							onDrop,
						}}
					>
						<svg
							class="floorplan-overlay"
							viewBox="0 0 1 1"
							preserveAspectRatio="none"
							aria-hidden="true"
						>
							<For each={shownAreas()}>
								{(area: FloorplanAreaJson) => (
									<g
										class={`floorplan-area floorplan-area-editing floorplan-layer-${areaLayer(area)}`}
										classList={{ selected: selected() === area.id }}
										data-pan-hint
										onPointerDown={(e: PointerEvent) => dragArea(e, area)}
									>
										<polygon points={svgPoints(area.points)} />
									</g>
								)}
							</For>
							<Show when={draftPreview()}>
								{(points: () => Point[]) => (
									<polygon class="floorplan-draft" points={svgPoints(points())} />
								)}
							</Show>
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
							<Show when={scaleLine()}>
								{(line: () => { a: Point; b: Point }) => (
									<line
										class="floorplan-scale-line"
										classList={{
											'floorplan-scale-line-draft': scaleDraft() !== null,
										}}
										x1={line().a[0]}
										y1={line().a[1]}
										x2={line().b[0]}
										y2={line().b[1]}
									/>
								)}
							</Show>
						</svg>
						<For each={shownAreas()}>
							{(area: FloorplanAreaJson) => (
								<span
									class="floorplan-area-label floorplan-area-label-static"
									style={{
										left: percent(areaCenter(area).x),
										top: percent(areaCenter(area).y),
									}}
								>
									{areaName(area)}
								</span>
							)}
						</For>
						<Show when={selectedArea()}>
							{(area: () => FloorplanAreaJson) => (
								<>
									<Index each={edgeMidpoints(area().points)}>
										{(point: () => Point, index: number) => (
											<div
												class="floorplan-handle floorplan-handle-midpoint"
												style={{
													left: percent(point()[0]),
													top: percent(point()[1]),
												}}
												onPointerDown={(e: PointerEvent) =>
													dragMidpoint(e, area(), index)
												}
											/>
										)}
									</Index>
									<Index each={area().points}>
										{(point: () => Point, index: number) => (
											// biome-ignore lint/a11y/noStaticElementInteractions: Pointer-only shape editing, like the other handles.
											<div
												class="floorplan-handle"
												classList={{
													'floorplan-handle-vertex': !isRect(
														area().points,
													),
												}}
												style={{
													left: percent(point()[0]),
													top: percent(point()[1]),
												}}
												onPointerDown={(e: PointerEvent) =>
													dragCorner(e, area(), index)
												}
												onDblClick={() => removeCorner(area(), index)}
											/>
										)}
									</Index>
								</>
							)}
						</Show>
						<For each={shownPlacements()}>
							{(placement: FloorplanPlacementJson) => (
								<div
									class="floorplan-marker floorplan-marker-editing"
									classList={{
										...markerClasses(placement),
										selected: selectedMarker() === placement.id,
									}}
									style={{
										left: percent(placement.x),
										top: percent(placement.y),
									}}
									title={markerTitle(placement)}
									data-pan-hint
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
						<Show when={planScale()}>
							{(current: () => FloorplanScale) => (
								<>
									<For each={['a', 'b'] as const}>
										{(end: 'a' | 'b') => (
											<div
												class="floorplan-handle floorplan-handle-scale"
												style={{
													left: percent(current()[end][0]),
													top: percent(current()[end][1]),
												}}
												title={t('floorplan.scalePoint')}
												onPointerDown={(e: PointerEvent) =>
													dragScalePoint(e, end)
												}
											/>
										)}
									</For>
									<button
										type="button"
										class="floorplan-scale-label"
										style={{
											left: percent((current().a[0] + current().b[0]) / 2),
											top: percent((current().a[1] + current().b[1]) / 2),
										}}
										title={t('floorplan.scaleEdit')}
										onPointerDown={(e: PointerEvent) => e.stopPropagation()}
										onClick={() =>
											setAskDistance({ a: current().a, b: current().b })
										}
									>
										{formatCentimeters(current().centimeters)}
									</button>
								</>
							)}
						</Show>
						<Show when={planOrigin()}>
							{(point: () => Point) => (
								<div
									class="floorplan-handle floorplan-handle-origin"
									style={{ left: percent(point()[0]), top: percent(point()[1]) }}
									title={t('floorplan.origin')}
									onPointerDown={dragOrigin}
								/>
							)}
						</Show>
						<Show when={snapMark()}>
							{(point: () => Point) => (
								<span
									class="floorplan-snap-mark"
									style={{ left: percent(point()[0]), top: percent(point()[1]) }}
									aria-hidden="true"
								/>
							)}
						</Show>
						<Show when={sequence() !== null}>
							<div class="floorplan-sequence-layer" onPointerDown={placeNext} />
						</Show>
						<Show when={tool() !== null}>
							{/* Covers the plan so the pointer picks points instead of moving what lies below. */}
							<div
								class="floorplan-draw-layer"
								onPointerDown={calibrateStart}
								onPointerMove={(e: PointerEvent) => {
									const pending = scaleDraft()
									if (pending && !pending.b) {
										setHover(stagePoint(e))
									}
								}}
							/>
						</Show>
						<Show when={drawing()}>
							{/* Covers the plan so the pointer draws instead of moving what lies below. */}
							{/* biome-ignore lint/a11y/noStaticElementInteractions: Enter finishes the polygon from the keyboard. */}
							<div
								class="floorplan-draw-layer"
								onPointerDown={drawStart}
								onPointerMove={(e: PointerEvent) => {
									if (rectDragging()) {
										return
									}
									// The snap mark shows ahead of the first corner too.
									const at = snapped(e, stagePoint(e))
									if (draft() !== null) {
										setHover(at)
									}
								}}
								onPointerLeave={() => {
									setHover(null)
									setSnapMark(null)
								}}
								onDblClick={finishPolygon}
							/>
							<Show when={(draft()?.length ?? 0) >= 3 && !rectDragging()}>
								{/* Clicking the first corner closes the polygon. */}
								<div
									class="floorplan-handle floorplan-handle-close"
									style={{
										left: percent(draft()?.[0][0] ?? 0),
										top: percent(draft()?.[0][1] ?? 0),
									}}
									title={t('floorplan.closePolygon')}
									onPointerDown={(e: PointerEvent) => {
										e.preventDefault()
										e.stopPropagation()
										finishPolygon()
									}}
								/>
							</Show>
						</Show>
					</FloorplanStage>
					<Show when={selectedArea()}>
						{(area: () => FloorplanAreaJson) => (
							<div class="floorplan-inspector">
								<label>
									<span>
										{t('floorplan.areaLabel', { name: area().target_name })}
									</span>
									<input
										value={area().label ?? ''}
										placeholder={area().target_name}
										maxLength={100}
										onInput={(
											e: InputEvent & { currentTarget: HTMLInputElement },
										) => patchArea(area().id, { label: e.currentTarget.value })}
									/>
								</label>
								<button type="button" onClick={() => deleteArea(area().id)}>
									{t('floorplan.deleteArea')}
								</button>
							</div>
						)}
					</Show>
				</div>
				<aside class="floorplan-palette" aria-label={t('floorplan.palette')}>
					<div class="floorplan-palette-actions">
						<button
							type="button"
							class="floorplan-draw-toggle"
							aria-pressed={drawing()}
							classList={{ active: drawing() }}
							onClick={() => toggleDrawing(!drawing())}
						>
							<IconLabel icon={IconPencilPlus}>{t('floorplan.drawArea')}</IconLabel>
						</button>
						<button
							type="button"
							class="floorplan-draw-toggle floorplan-snap-toggle"
							aria-pressed={snapEnabled()}
							classList={{ active: snapEnabled() }}
							title={t('floorplan.snapHint')}
							onClick={toggleSnap}
						>
							<IconLabel icon={IconMagnet}>{t('floorplan.snap')}</IconLabel>
						</button>
						<Show when={(draft()?.length ?? 0) >= 3 && !rectDragging()}>
							<p class="floorplan-hint">{t('floorplan.finishHint')}</p>
						</Show>
						<Show when={sequence() !== null}>
							<p class="floorplan-hint">{t('floorplan.sequenceActive')}</p>
						</Show>
						<div class="floorplan-calibration">
							<button
								type="button"
								aria-pressed={tool() === 'scale'}
								classList={{ active: tool() === 'scale' }}
								onClick={() => selectTool(tool() === 'scale' ? null : 'scale')}
							>
								<IconLabel icon={IconRulerMeasure}>
									{t('floorplan.setScale')}
								</IconLabel>
							</button>
							<button
								type="button"
								aria-pressed={tool() === 'origin'}
								classList={{ active: tool() === 'origin' }}
								onClick={() => selectTool(tool() === 'origin' ? null : 'origin')}
							>
								<IconLabel icon={IconCurrentLocation}>
									{t('floorplan.setOrigin')}
								</IconLabel>
							</button>
						</div>
						<Switch>
							<Match when={tool() === 'scale'}>
								<p class="floorplan-hint">
									{t(
										scaleDraft()
											? 'floorplan.scaleSecondHint'
											: 'floorplan.scaleHint',
									)}
								</p>
							</Match>
							<Match when={tool() === 'origin'}>
								<p class="floorplan-hint">{t('floorplan.originHint')}</p>
							</Match>
						</Switch>
						<Show when={planScale()}>
							{(current: () => FloorplanScale) => (
								<p class="floorplan-calibration-state">
									<span>
										{t('floorplan.scaleState', {
											distance: formatCentimeters(current().centimeters),
										})}
									</span>
									<button
										type="button"
										class="floorplan-link-button"
										onClick={() => setScale(null)}
									>
										{t('floorplan.remove')}
									</button>
								</p>
							)}
						</Show>
						<Show when={planOrigin()}>
							<p class="floorplan-calibration-state">
								<span>{t('floorplan.originState')}</span>
								<button
									type="button"
									class="floorplan-link-button"
									onClick={() => setOrigin(null)}
								>
									{t('floorplan.remove')}
								</button>
							</p>
						</Show>
					</div>
					<div class="floorplan-kinds floorplan-side-tabs">
						<button
							type="button"
							class="floorplan-side-tab"
							aria-pressed={tab() === 'palette'}
							classList={{ active: tab() === 'palette' }}
							onClick={() => setTab('palette')}
						>
							{t('floorplan.paletteTab')}
						</button>
						<button
							type="button"
							class="floorplan-side-tab"
							aria-pressed={tab() === 'objects'}
							classList={{ active: tab() === 'objects' }}
							onClick={() => setTab('objects')}
						>
							{t('floorplan.objectsTab', {
								count: areas().length + placements().length,
							})}
						</button>
					</div>
					<input
						type="search"
						class="floorplan-palette-search"
						placeholder={
							tab() === 'palette'
								? t('floorplan.paletteSearch')
								: t('floorplan.objectSearch')
						}
						aria-label={
							tab() === 'palette'
								? t('floorplan.paletteSearch')
								: t('floorplan.objectSearch')
						}
						value={search()}
						onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
							setSearch(e.currentTarget.value)
						}
					/>
					<Show
						when={tab() === 'palette'}
						fallback={
							<ObjectList
								areas={areas()}
								placements={placements()}
								search={search()}
								selected={selectedObject()}
								on_select={selectObject}
								actions={{
									rename_area: (id: number, label: string) =>
										patchArea(id, { label }),
									delete_area: deleteArea,
									remove_marker: removeMarker,
								}}
							/>
						}
					>
						<Palette
							search={search()}
							candidates={candidates()}
							loading={candidates.loading}
							placed={placed()}
							sequence={sequence()}
							on_sequence={startSequence}
							on_drag={setDragged}
							on_place={(candidate: FloorplanCandidateJson) =>
								addPlacement(candidate, zoom.viewCenter())
							}
						/>
					</Show>
				</aside>
			</div>
			<Show when={askDistance()}>
				<ScaleDistanceDialog
					centimeters={planScale()?.centimeters ?? null}
					on_save={saveDistance}
					on_close={() => setAskDistance(null)}
				/>
			</Show>
			<Show when={picking()}>
				<AreaTargetPicker
					attachment={props.attachment}
					areas={areas()}
					on_select={addArea}
					on_close={closePicker}
				/>
			</Show>
		</div>
	)
}
