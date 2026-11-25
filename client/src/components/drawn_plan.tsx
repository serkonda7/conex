/**
 * Drawn floor plan (v2) of a site or location, the body of
 * `/floorplans-v2/:id`: the sheet with its walls, doors, windows, stairs,
 * cable trays, desks, desk groups and rooms over the optional reference
 * image, and the rack, device and outlet markers. A marker links to its rack
 * or device; an outlet opens its popover (trace and connect) like on image
 * plans. Rooms and desks linked to a location carry a label linking to it.
 * The view switches between the 2D stage and a 3D view (kept per browser;
 * three.js loads on first use). In 2D, another floor of the building may
 * show beneath the drawing (`drawn_plan_stack`). Edit swaps the view for the editor on the
 * same zoom, always in 2D.
 */
import {
	IconCube,
	IconInfoCircle,
	IconPencil,
	IconPhoto,
	IconTag,
	IconTrash,
} from '@tabler/icons-solidjs'
import { createSignal, For, type JSX, lazy, onMount, Show, Suspense } from 'solid-js'
import {
	delete_drawing,
	type FloorplanDrawingJson,
	type FloorplanDrawingPlacementJson,
	type FloorplanRoom,
} from '../api/floorplan_drawings'
import { t } from '../i18n'
import { queryParam } from '../lib/router'
import { can } from '../lib/session'
import { readStored, writeStored } from '../lib/storage'
import { useDetailDelete } from './detail_page'
import { DrawnPlanEditor } from './drawn_plan_editor'
import { type Point, polygonCenter } from './drawn_plan_geometry'
import {
	createFloorStack,
	type FloorStack,
	UnderlayLayer,
	UnderlayPicker,
} from './drawn_plan_stack'
import {
	DeskGroupLayer,
	DeskLayer,
	type DeskSeat,
	DrawnPlanStage,
	deskSeats,
	drawingWalls,
	locationNames,
	percentOf,
	RoomLayer,
	referenceOpacity,
	referenceVisible,
	StairLayer,
	stageItems,
	TrayLayer,
	toggleReferenceVisible,
	WallLayer,
} from './drawn_plan_stage'
import { InlineError, Loading } from './feedback'
import { markerNamesVisible, toggleMarkerNames } from './floorplan_layers'
import { isOutlet, type OutletPlacement, OutletPopover } from './floorplan_outlet'
import { MarkerGlyph, MarkerName, markerClasses, markerHref, markerTitle } from './floorplan_stage'
import { IconLabel } from './icon_label'
import { PlanFullscreenTitle } from './plan_fullscreen'
import { createStageZoom, type StageZoom } from './zoom_viewport'

/** The 3D view, in its own chunk with three.js. */
const DrawnPlan3D = lazy(() => import('./drawn_plan_3d'))

const MODE_STORAGE_KEY = 'conex:drawn-plan-3d'

const [shown3d, setShown3d] = createSignal(readStored(MODE_STORAGE_KEY) === 'true')

function toggle3d(): void {
	const next = !shown3d()
	setShown3d(next)
	writeStored(MODE_STORAGE_KEY, String(next))
}

/** A room's or desk's label: on the stage at `at`, linking to its location when visible. */
export interface PlanLabel {
	key: string
	at: Point
	/** Height above the floor in 3D, cm: a desk's top, a room's floor. */
	height: number
	text: string
	location_id: number | null
	kind: 'room' | 'desk'
}

/**
 * Labels of the rooms (their label, else the linked location's name) and of
 * the linked desks, also those of desk groups (the location's name). `names` holds the locations the
 * requester may see; a link to another stays unlabelled unless the room has
 * its own label.
 */
export function planLabels(
	rooms: { key: string; room: FloorplanRoom }[],
	desks: DeskSeat[],
	names: Map<number, string>,
): PlanLabel[] {
	const name = (id: number | undefined): string | undefined =>
		id === undefined ? undefined : names.get(id)
	return [
		...rooms.flatMap(({ key, room }) => {
			const text = room.label || name(room.location_id)
			return text
				? [
						{
							key,
							at: polygonCenter(room.points),
							height: 0,
							text,
							location_id:
								name(room.location_id) === undefined
									? null
									: (room.location_id ?? null),
							kind: 'room' as const,
						},
					]
				: []
		}),
		...desks.flatMap((seat: DeskSeat) => {
			const text = name(seat.location_id)
			return text
				? [
						{
							key: seat.key,
							at: seat.at,
							height: seat.height,
							text,
							location_id: seat.location_id ?? null,
							kind: 'desk' as const,
						},
					]
				: []
		}),
	]
}

/**
 * The plan as viewed, in 2D or 3D: inert walls, linked markers, toggles for
 * the mode, the reference image and the names.
 */
function DrawnPlanViewer(props: {
	drawing: FloorplanDrawingJson
	zoom: StageZoom
	stack: FloorStack
}): JSX.Element {
	const [outlet, setOutlet] = createSignal<OutletPlacement | null>(null)
	const [pointer, setPointer] = createSignal<Point | null>(null)
	let stage: HTMLDivElement | undefined
	const at = (placement: { x: number; y: number }): { left: string; top: string } => ({
		left: percentOf(placement.x, props.drawing.width),
		top: percentOf(placement.y, props.drawing.height),
	})
	const trackPointer = (e: PointerEvent): void => {
		const box = stage?.getBoundingClientRect()
		if (!box || box.width === 0) {
			return
		}
		const x = ((e.clientX - box.left) / box.width) * props.drawing.width
		const y = ((e.clientY - box.top) / box.height) * props.drawing.height
		setPointer(
			x < 0 || y < 0 || x > props.drawing.width || y > props.drawing.height ? null : [x, y],
		)
	}
	const empty = (): boolean =>
		props.drawing.walls.length === 0 &&
		props.drawing.stairs.length === 0 &&
		props.drawing.trays.length === 0 &&
		props.drawing.desks.length === 0 &&
		props.drawing.desk_groups.length === 0 &&
		props.drawing.rooms.length === 0 &&
		props.drawing.placements.length === 0
	const labels = (): PlanLabel[] =>
		planLabels(
			props.drawing.rooms.map((room, i: number) => ({ key: `room:${i}`, room })),
			deskSeats(
				stageItems('desk', props.drawing.desks),
				stageItems('group', props.drawing.desk_groups),
			),
			locationNames(props.drawing.linked_locations),
		)
	/** The bar's toggles; a function, as each mode mounts its own copy. */
	const toggles = (): JSX.Element => (
		<>
			<button
				type="button"
				class="floorplan-layer-toggle floorplan-names-toggle"
				aria-pressed={shown3d()}
				title={t(shown3d() ? 'drawnPlan.show2d' : 'drawnPlan.show3d')}
				onClick={toggle3d}
			>
				<IconCube size={12} aria-hidden="true" />
				<span>{t('drawnPlan.view3d')}</span>
			</button>
			<Show when={props.drawing.reference}>
				<button
					type="button"
					class="floorplan-layer-toggle floorplan-names-toggle"
					aria-pressed={referenceVisible()}
					title={t(
						referenceVisible() ? 'drawnPlan.hideReference' : 'drawnPlan.showReference',
					)}
					onClick={toggleReferenceVisible}
				>
					<IconPhoto size={12} aria-hidden="true" />
					<span>{t('drawnPlan.reference')}</span>
				</button>
			</Show>
			<Show when={props.drawing.placements.length > 0}>
				<button
					type="button"
					class="floorplan-layer-toggle floorplan-names-toggle"
					aria-pressed={markerNamesVisible()}
					title={t(
						markerNamesVisible()
							? 'floorplan.hideMarkerNames'
							: 'floorplan.showMarkerNames',
					)}
					onClick={toggleMarkerNames}
				>
					<IconTag size={12} aria-hidden="true" />
					<span>{t('floorplan.markerNames')}</span>
				</button>
			</Show>
		</>
	)

	return (
		<div class="drawn-plan-view">
			<Show when={empty()}>
				<p class="floorplan-hint">{t('drawnPlan.empty')}</p>
			</Show>
			<Show
				when={!shown3d()}
				fallback={
					<Suspense fallback={<Loading message={t('common.loading')} />}>
						<DrawnPlan3D
							drawing={props.drawing}
							labels={labels()}
							reference_opacity={referenceVisible() ? referenceOpacity() : null}
							bar={toggles()}
						/>
					</Suspense>
				}
			>
				<DrawnPlanStage
					sheet={{ width: props.drawing.width, height: props.drawing.height }}
					zoom={props.zoom}
					reference={referenceVisible() ? props.drawing.reference : null}
					reference_opacity={referenceOpacity()}
					grid={null}
					pointer={pointer()}
					ref={(el: HTMLDivElement) => {
						stage = el
					}}
					onPointerMove={trackPointer}
					onPointerLeave={() => setPointer(null)}
					underlay={
						<Show when={props.stack.underlayDrawing()}>
							{(below: () => FloorplanDrawingJson) => (
								<UnderlayLayer drawing={below()} offset={props.drawing.offset} />
							)}
						</Show>
					}
					walls={
						<>
							<RoomLayer rooms={stageItems('room', props.drawing.rooms)} />
							<StairLayer
								stairs={props.drawing.stairs.map((stair, i: number) => ({
									key: `stair:${i}`,
									stair,
								}))}
							/>
							<DeskLayer desks={stageItems('desk', props.drawing.desks)} />
							<DeskGroupLayer
								groups={stageItems('group', props.drawing.desk_groups)}
							/>
							<TrayLayer trays={stageItems('tray', props.drawing.trays)} />
							<WallLayer walls={drawingWalls(props.drawing)} />
						</>
					}
					bar={
						<>
							{toggles()}
							<UnderlayPicker stack={props.stack} />
						</>
					}
				>
					<For each={labels()}>
						{(label: PlanLabel) => (
							<Show
								when={label.location_id}
								fallback={
									<span
										class="drawn-plan-name"
										classList={{
											'drawn-plan-name-desk': label.kind === 'desk',
										}}
										style={at({ x: label.at[0], y: label.at[1] })}
									>
										{label.text}
									</span>
								}
							>
								{(id: () => number) => (
									<a
										href={`/locations/${id()}`}
										class="drawn-plan-name"
										classList={{
											'drawn-plan-name-desk': label.kind === 'desk',
										}}
										style={at({ x: label.at[0], y: label.at[1] })}
										title={label.text}
										draggable={false}
									>
										{label.text}
									</a>
								)}
							</Show>
						)}
					</For>
					<For each={props.drawing.placements}>
						{(placement: FloorplanDrawingPlacementJson) => (
							<Show
								when={isOutlet(placement) ? placement : undefined}
								fallback={
									<a
										href={markerHref(placement)}
										class="floorplan-marker"
										classList={markerClasses(placement)}
										style={at(placement)}
										title={markerTitle(placement)}
										aria-label={markerTitle(placement)}
										draggable={false}
									>
										<MarkerGlyph placement={placement} size={16} />
										<MarkerName placement={placement} />
									</a>
								}
							>
								{(outletPlacement: () => OutletPlacement) => (
									<button
										type="button"
										class="floorplan-marker"
										classList={markerClasses(placement)}
										style={at(placement)}
										title={markerTitle(placement)}
										aria-label={markerTitle(placement)}
										onClick={() => setOutlet(outletPlacement())}
									>
										<MarkerGlyph placement={placement} size={16} />
										<MarkerName placement={placement} />
									</button>
								)}
							</Show>
						)}
					</For>
					<Show when={outlet()}>
						{(open: () => OutletPlacement) => (
							// The popover positions itself in normalized coordinates.
							<OutletPopover
								placement={{
									...open(),
									x: open().x / props.drawing.width,
									y: open().y / props.drawing.height,
								}}
								on_close={() => setOutlet(null)}
							/>
						)}
					</Show>
				</DrawnPlanStage>
			</Show>
		</div>
	)
}

/**
 * Page header and body of a drawn plan: `title`, a note that the drawing's
 * measurements are not reliable, and Edit and Delete; then the plan or,
 * while editing, the editor. `?edit=1` opens the editor right
 * away (a plan just created).
 */
export function DrawnPlanView(props: {
	drawing: FloorplanDrawingJson
	title: string
	on_saved: (drawing: FloorplanDrawingJson) => void
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [editing, setEditing] = createSignal(false)
	const [actions, setActions] = createSignal<HTMLElement>()
	// Shared by the view and the editor, so switching modes keeps zoom and pan.
	const zoom = createStageZoom()
	// Likewise the floor shown beneath.
	const stack = createFloorStack(() => props.drawing, setError)
	onMount(() => {
		if (queryParam('edit') === '1' && can('edit')) {
			setEditing(true)
		}
	})
	const handleDelete = useDetailDelete({
		noun: 'noun.drawnFloorplan',
		name: () => props.title,
		id: props.drawing.id,
		remove: delete_drawing,
		setError,
		listRoute: '/floorplans-v2',
	})

	return (
		<>
			<div class="page-header">
				<PlanFullscreenTitle>{props.title}</PlanFullscreenTitle>
				<p class="drawn-plan-disclaimer">
					<IconInfoCircle size={14} aria-hidden="true" />
					<span>{t('drawnPlan.disclaimer')}</span>
				</p>
				<div class="page-header-actions">
					<Show when={can('edit') || can('delete')}>
						{/* The editor puts Undo / Save / Cancel here, so the header keeps its height. */}
						<div class="form-actions" ref={setActions}>
							<Show when={!editing()}>
								<Show when={can('edit')}>
									<button type="button" onClick={() => setEditing(true)}>
										<IconLabel icon={IconPencil}>
											{t('drawnPlan.edit')}
										</IconLabel>
									</button>
								</Show>
								<Show when={can('delete')}>
									<button
										type="button"
										class="btn-danger"
										onClick={() => void handleDelete()}
									>
										<IconLabel icon={IconTrash}>{t('common.delete')}</IconLabel>
									</button>
								</Show>
							</Show>
						</div>
					</Show>
				</div>
			</div>
			<Show
				when={editing()}
				fallback={<DrawnPlanViewer drawing={props.drawing} zoom={zoom} stack={stack} />}
			>
				<DrawnPlanEditor
					drawing={props.drawing}
					zoom={zoom}
					stack={stack}
					on_saved={(saved: FloorplanDrawingJson) => {
						props.on_saved(saved)
						setEditing(false)
					}}
					on_cancel={() => setEditing(false)}
					actions_mount={actions()}
				/>
			</Show>
			<InlineError message={error()} />
		</>
	)
}
