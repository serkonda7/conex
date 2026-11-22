/**
 * Drawn floor plan (v2) of a site or location, the body of
 * `/floorplans-v2/:id`: the sheet with its walls, doors and windows over the
 * optional reference image, and the rack, device and outlet markers. A
 * marker links to its rack or device; an outlet opens its popover (trace
 * and connect) like on image plans. Edit swaps the view for the editor on
 * the same zoom.
 */
import { IconPencil, IconPhoto, IconTag, IconTrash } from '@tabler/icons-solidjs'
import { createSignal, For, type JSX, onMount, Show } from 'solid-js'
import type { FloorplanPlacementJson } from '../api/attachments'
import { delete_drawing, type FloorplanDrawingJson } from '../api/floorplan_drawings'
import { t } from '../i18n'
import { queryParam } from '../lib/router'
import { can } from '../lib/session'
import { useDetailDelete } from './detail_page'
import { DrawnPlanEditor } from './drawn_plan_editor'
import type { Point } from './drawn_plan_geometry'
import {
	DrawnPlanStage,
	percentOf,
	referenceOpacity,
	referenceVisible,
	type StageWall,
	toggleReferenceVisible,
	WallLayer,
} from './drawn_plan_stage'
import { InlineError } from './feedback'
import { markerNamesVisible, toggleMarkerNames } from './floorplan_layers'
import { isOutlet, type OutletPlacement, OutletPopover } from './floorplan_outlet'
import { MarkerGlyph, MarkerName, markerClasses, markerTitle } from './floorplan_stage'
import { IconLabel } from './icon_label'
import { createStageZoom, type StageZoom } from './zoom_viewport'

/** The plan's walls with their openings, keyed by index. */
export function drawingWalls(drawing: FloorplanDrawingJson): StageWall[] {
	return drawing.walls.map((wall, index: number) => ({
		key: `wall:${index}`,
		wall,
		openings: drawing.openings.flatMap((opening, i: number) =>
			opening.wall === index ? [{ key: `opening:${i}`, opening }] : [],
		),
	}))
}

function markerHref(placement: FloorplanPlacementJson): string {
	if (placement.port) {
		return `/devices/${placement.port.device_id}`
	}
	return placement.rack_id !== null
		? `/racks/${placement.rack_id}`
		: `/devices/${placement.device_id}`
}

/** The plan as viewed: inert walls, linked markers, toggles for the reference image and names. */
function DrawnPlanViewer(props: { drawing: FloorplanDrawingJson; zoom: StageZoom }): JSX.Element {
	const [outlet, setOutlet] = createSignal<OutletPlacement | null>(null)
	const [pointer, setPointer] = createSignal<Point | null>(null)
	let stage: HTMLDivElement | undefined
	const at = (placement: FloorplanPlacementJson): { left: string; top: string } => ({
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
		props.drawing.walls.length === 0 && props.drawing.placements.length === 0

	return (
		<div class="drawn-plan-view">
			<Show when={empty()}>
				<p class="floorplan-hint">{t('drawnPlan.empty')}</p>
			</Show>
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
				walls={<WallLayer walls={drawingWalls(props.drawing)} />}
				bar={
					<>
						<Show when={props.drawing.reference}>
							<button
								type="button"
								class="floorplan-layer-toggle floorplan-names-toggle"
								aria-pressed={referenceVisible()}
								title={t(
									referenceVisible()
										? 'drawnPlan.hideReference'
										: 'drawnPlan.showReference',
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
				}
			>
				<For each={props.drawing.placements}>
					{(placement: FloorplanPlacementJson) => (
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
		</div>
	)
}

/**
 * Page header and body of a drawn plan: `title` with Edit and Delete, then
 * the plan or, while editing, the editor. `?edit=1` opens the editor right
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
				<h2>{props.title}</h2>
				<Show when={can('edit') || can('delete')}>
					{/* The editor puts Undo / Save / Cancel here, so the header keeps its height. */}
					<div class="form-actions" ref={setActions}>
						<Show when={!editing()}>
							<Show when={can('edit')}>
								<button type="button" onClick={() => setEditing(true)}>
									<IconLabel icon={IconPencil}>{t('drawnPlan.edit')}</IconLabel>
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
			<Show
				when={editing()}
				fallback={<DrawnPlanViewer drawing={props.drawing} zoom={zoom} />}
			>
				<DrawnPlanEditor
					drawing={props.drawing}
					zoom={zoom}
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
