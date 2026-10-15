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
 * - Palette: unplaced racks and devices, grouped by location. Dragging an
 *   item onto the stage (HTML5 drag and drop) places a marker at the drop
 *   point; a click places it in the center. Markers move with pointer
 *   events and are removed with ×.
 *
 * All coordinates are clamped to 0..1.
 */
import { IconPencilPlus, IconX } from '@tabler/icons-solidjs'
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
import { Dynamic, Portal } from 'solid-js/web'
import {
	type AttachmentJson,
	type FloorplanAreaJson,
	type FloorplanCandidateJson,
	type FloorplanJson,
	type FloorplanPlacementJson,
	type FloorplanPut,
	fetch_floorplan_candidates,
	put_floorplan,
} from '../api/attachments'
import { fetch_locations, fetch_sites } from '../api/tenancy'
import { t, tp } from '../i18n'
import { createRows, useAction } from '../lib/resource'
import { useLeaveGuard } from '../lib/router'
import { tenantContextFilters } from '../lib/tenant_context'
import { InlineError, Loading } from './feedback'
import {
	areaCenter,
	areaName,
	FloorplanStage,
	markerIcon,
	markerTitle,
	percent,
} from './floorplan_stage'
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
function toPut(areas: FloorplanAreaJson[], placements: FloorplanPlacementJson[]): FloorplanPut {
	return {
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
				: { device_id: placement.device_id ?? undefined }),
			x: placement.x,
			y: placement.y,
		})),
	}
}

function candidateKey(candidate: { rack_id: number | null; device_id: number | null }): string {
	return candidate.rack_id !== null
		? `rack:${candidate.rack_id}`
		: `device:${candidate.device_id}`
}

type TargetKind = 'site' | 'location'

interface AreaTarget {
	kind: TargetKind
	id: number
	name: string
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

	const load = async (search: string): Promise<Result<{ id: number; name: string }[], Error>> => {
		const filters = { search, ...tenantContextFilters() }
		const res: Result<{ items: { id: number; name: string }[] }, Error> =
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
								on_select={(row: { id: number; name: string }) =>
									props.on_select({ kind: option, id: row.id, name: row.name })
								}
							/>
						</Match>
					)}
				</For>
			</Switch>
		</Modal>
	)
}

interface PaletteGroup {
	name: string
	items: FloorplanCandidateJson[]
}

/**
 * The side list of the editor: `actions` on top, then a search field plus
 * the unplaced racks and devices, grouped by location.
 */
function Palette(props: {
	actions: JSX.Element
	candidates: FloorplanCandidateJson[] | undefined
	loading: boolean
	placed: Set<string>
	on_drag: (key: string | null) => void
	on_place: (candidate: FloorplanCandidateJson) => void
}): JSX.Element {
	const [search, setSearch] = createSignal('')
	const groups = createMemo(() => {
		const needle = search().trim().toLowerCase()
		const byLocation = new Map<string, FloorplanCandidateJson[]>()
		for (const candidate of props.candidates ?? []) {
			if (props.placed.has(candidateKey(candidate))) {
				continue
			}
			const group = candidate.location_name ?? t('floorplan.noLocation')
			if (
				needle &&
				!candidate.name.toLowerCase().includes(needle) &&
				!group.toLowerCase().includes(needle)
			) {
				continue
			}
			byLocation.set(group, [...(byLocation.get(group) ?? []), candidate])
		}
		return [...byLocation.entries()]
			.map(([name, items]) => ({
				name,
				items: items.sort((a, b) => a.name.localeCompare(b.name)),
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	})

	return (
		<aside class="floorplan-palette" aria-label={t('floorplan.palette')}>
			<div class="floorplan-palette-actions">{props.actions}</div>
			<h4>{t('floorplan.palette')}</h4>
			<input
				type="search"
				class="floorplan-palette-search"
				placeholder={t('floorplan.paletteSearch')}
				aria-label={t('floorplan.paletteSearch')}
				value={search()}
				onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
					setSearch(e.currentTarget.value)
				}
			/>
			<Show when={!props.loading} fallback={<Loading message={t('common.loading')} />}>
				<Show
					when={groups().length > 0}
					fallback={<p class="floorplan-hint">{t('floorplan.paletteEmpty')}</p>}
				>
					<For each={groups()}>
						{(group: PaletteGroup) => (
							<section>
								<h5>{group.name}</h5>
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
													<Dynamic
														component={markerIcon(candidate)}
														size={14}
													/>
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
		</aside>
	)
}

/** Edit mode of one floor plan; replaces the view until saved or cancelled. */
export function FloorplanEditor(props: {
	attachment: AttachmentJson
	plan: FloorplanJson
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
	const [drawing, setDrawing] = createSignal(false)
	/** Area being drawn (rectangle or polygon corners), then held while its target is picked. */
	const [draft, setDraft] = createSignal<Point[] | null>(null)
	/** Pointer position over the plan while drawing a polygon, for the next edge's preview. */
	const [hover, setHover] = createSignal<Point | null>(null)
	const [picking, setPicking] = createSignal(false)
	const [dragged, setDragged] = createSignal<string | null>(null)
	const [stage, setStage] = createSignal<HTMLDivElement>()
	const [candidates] = createRows(() => fetch_floorplan_candidates(props.attachment.id), setError)
	const save = useAction(setError)

	// Items added in the editor have no id yet: negative ones never clash.
	let nextId = -1

	const initial = JSON.stringify(toPut(props.plan.areas, props.plan.placements))
	const dirty = createMemo(() => JSON.stringify(toPut(areas(), placements())) !== initial)

	const placed = createMemo(
		() =>
			new Set(
				placements().map((placement: FloorplanPlacementJson) => candidateKey(placement)),
			),
	)
	const selectedArea = createMemo(() =>
		areas().find((area: FloorplanAreaJson) => area.id === selected()),
	)

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

	/**
	 * Starts a pointer drag: `move` gets the distance from the start in plan
	 * coordinates until the button is released.
	 */
	function startDrag(
		e: PointerEvent,
		move: (dx: number, dy: number) => void,
		end?: () => void,
	): void {
		e.preventDefault()
		e.stopPropagation()
		const start = stagePoint(e)
		const onMove = (ev: PointerEvent): void => {
			const at = stagePoint(ev)
			move(at[0] - start[0], at[1] - start[1])
		}
		const onUp = (): void => {
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
			window.removeEventListener('pointercancel', onUp)
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
		const origin = area.points
		startDrag(e, (dx: number, dy: number) =>
			patchArea(area.id, { points: shiftPoints(origin, dx, dy) }),
		)
	}

	function dragCorner(e: PointerEvent, area: FloorplanAreaJson, index: number): void {
		const origin = area.points
		startDrag(e, (dx: number, dy: number) =>
			patchArea(area.id, {
				points: moveCorner(origin, index, [
					clamp01(origin[index][0] + dx),
					clamp01(origin[index][1] + dy),
				]),
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
		const [x, y] = [placement.x, placement.y]
		startDrag(e, (dx: number, dy: number) =>
			patchPlacement(placement.id, { x: clamp01(x + dx), y: clamp01(y + dy) }),
		)
	}

	/** True while a rectangle is dragged out; a draft otherwise is a polygon in progress. */
	const [rectDragging, setRectDragging] = createSignal(false)

	function toggleDrawing(on: boolean): void {
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
		const from = stagePoint(e)
		startDrag(
			e,
			(dx: number, dy: number) => {
				if (
					!rectDragging() &&
					Math.abs(dx) < MIN_AREA_SIZE &&
					Math.abs(dy) < MIN_AREA_SIZE
				) {
					return
				}
				setRectDragging(true)
				setHover(null)
				setDraft(rectPoints(from, [clamp01(from[0] + dx), clamp01(from[1] + dy)]))
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
		const at = stagePoint(e)
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
				target_type: null,
				target_plan_id: null,
			},
		])
		setSelected(id)
	}

	function deleteArea(id: number): void {
		setAreas((all: FloorplanAreaJson[]) =>
			all.filter((area: FloorplanAreaJson) => area.id !== id),
		)
		setSelected(null)
	}

	function addPlacement(candidate: FloorplanCandidateJson, at: Point): void {
		if (placed().has(candidateKey(candidate))) {
			return
		}
		setPlacements((all: FloorplanPlacementJson[]) => [
			...all,
			{
				id: nextId--,
				rack_id: candidate.rack_id,
				device_id: candidate.device_id,
				x: at[0],
				y: at[1],
				name: candidate.name,
				status: candidate.status,
				role_icon: candidate.role_icon,
			},
		])
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
			const res = await put_floorplan(props.attachment.id, toPut(areas(), placements()))
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
			<div class="floorplan-edit-layout">
				<div>
					<FloorplanStage
						attachment={props.attachment}
						ref={setStage}
						handlers={{
							onPointerDown: () => setSelected(null),
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
							<For each={areas()}>
								{(area: FloorplanAreaJson) => (
									<g
										class="floorplan-area floorplan-area-editing"
										classList={{ selected: selected() === area.id }}
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
						</svg>
						<For each={areas()}>
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
						<For each={placements()}>
							{(placement: FloorplanPlacementJson) => (
								<div
									class="floorplan-marker floorplan-marker-editing"
									classList={{
										'floorplan-marker-rack': placement.rack_id !== null,
										'floorplan-marker-inactive':
											placement.status !== null &&
											placement.status !== 'active',
									}}
									style={{
										left: percent(placement.x),
										top: percent(placement.y),
									}}
									title={markerTitle(placement)}
									onPointerDown={(e: PointerEvent) => dragMarker(e, placement)}
								>
									<Dynamic component={markerIcon(placement)} size={16} />
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
										onClick={() =>
											setPlacements((all: FloorplanPlacementJson[]) =>
												all.filter(
													(p: FloorplanPlacementJson) =>
														p.id !== placement.id,
												),
											)
										}
									>
										<IconX size={10} />
									</button>
								</div>
							)}
						</For>
						<Show when={drawing()}>
							{/* Covers the plan so the pointer draws instead of moving what lies below. */}
							{/* biome-ignore lint/a11y/noStaticElementInteractions: Enter finishes the polygon from the keyboard. */}
							<div
								class="floorplan-draw-layer"
								onPointerDown={drawStart}
								onPointerMove={(e: PointerEvent) =>
									draft() !== null && !rectDragging() && setHover(stagePoint(e))
								}
								onPointerLeave={() => setHover(null)}
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
				<Palette
					actions={
						<>
							<button
								type="button"
								class="floorplan-draw-toggle"
								aria-pressed={drawing()}
								classList={{ active: drawing() }}
								onClick={() => toggleDrawing(!drawing())}
							>
								<IconLabel icon={IconPencilPlus}>
									{t('floorplan.drawArea')}
								</IconLabel>
							</button>
							<Show when={(draft()?.length ?? 0) >= 3 && !rectDragging()}>
								<p class="floorplan-hint">{t('floorplan.finishHint')}</p>
							</Show>
						</>
					}
					candidates={candidates()}
					loading={candidates.loading}
					placed={placed()}
					on_drag={setDragged}
					on_place={(candidate: FloorplanCandidateJson) =>
						addPlacement(candidate, [0.5, 0.5])
					}
				/>
			</div>
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
