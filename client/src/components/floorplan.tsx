/**
 * Floor plan of a site or location (the body of `/floorplans/:id`): its
 * marked image capped in height with the plan's areas and markers on top. Coordinates are normalized to 0..1,
 * so the overlay scales with the image: areas are polygons in an SVG with
 * `viewBox="0 0 1 1"` stretched over it, labels and markers are positioned
 * in percent. An area links to its target's own floor plan, so plans drill
 * down site → floor → room (a target without one links to its detail page);
 * a marker links to its rack or device.
 *
 * The stage and its layers are separate pieces so the edit mode
 * (`FloorplanEditor`) can swap the view layers for editable ones on the same
 * stage.
 */
import { IconPencil } from '@tabler/icons-solidjs'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import {
	type AttachmentJson,
	type FloorplanAreaJson,
	type FloorplanJson,
	type FloorplanPlacementJson,
	fetch_floorplan,
} from '../api/attachments'
import { t } from '../i18n'
import { createRecord } from '../lib/resource'
import { goTo } from '../lib/router'
import { can } from '../lib/session'
import { InlineError, Loading } from './feedback'
import { FloorplanEditor } from './floorplan_editor'
import {
	areaCenter,
	areaName,
	FloorplanStage,
	markerIcon,
	markerTitle,
	percent,
} from './floorplan_stage'
import { IconLabel } from './icon_label'

/** The area target's own floor plan, else its detail page. */
function areaHref(area: FloorplanAreaJson): string {
	if (area.target_plan_id !== null) {
		return `/floorplans/${area.target_plan_id}`
	}
	return area.site_id !== null ? `/sites/${area.site_id}` : `/locations/${area.location_id}`
}

function markerHref(placement: FloorplanPlacementJson): string {
	return placement.rack_id !== null
		? `/racks/${placement.rack_id}`
		: `/devices/${placement.device_id}`
}

/**
 * Area polygons with their labels. The polygons react to the pointer only;
 * the label is the focusable link of each area.
 */
function AreaLayer(props: { areas: FloorplanAreaJson[] }): JSX.Element {
	return (
		<>
			<svg
				class="floorplan-overlay"
				viewBox="0 0 1 1"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<For each={props.areas}>
					{(area: FloorplanAreaJson) => (
						// A `<g>`, not an `<a>`: outside the `<svg>` literal Solid
						// would create an HTML anchor, which SVG does not render.
						// biome-ignore lint/a11y/noStaticElementInteractions: The adjacent area label provides the keyboard-accessible link.
						<g
							class="floorplan-area"
							onClick={(e: MouseEvent) => goTo(e, areaHref(area))}
							onAuxClick={(e: MouseEvent) => {
								if (e.button === 1) {
									goTo(e, areaHref(area))
								}
							}}
						>
							<polygon
								points={area.points.map((point) => point.join(',')).join(' ')}
							/>
						</g>
					)}
				</For>
			</svg>
			<For each={props.areas}>
				{(area: FloorplanAreaJson) => (
					<a
						href={areaHref(area)}
						class="floorplan-area-label"
						style={{
							left: percent(areaCenter(area).x),
							top: percent(areaCenter(area).y),
						}}
						aria-label={t('floorplan.openArea', { name: areaName(area) })}
					>
						{areaName(area)}
					</a>
				)}
			</For>
		</>
	)
}

/** Rack and device markers; the tooltip names the object and its status. */
function MarkerLayer(props: { placements: FloorplanPlacementJson[] }): JSX.Element {
	return (
		<For each={props.placements}>
			{(placement: FloorplanPlacementJson) => (
				<a
					href={markerHref(placement)}
					class="floorplan-marker"
					classList={{
						'floorplan-marker-rack': placement.rack_id !== null,
						'floorplan-marker-inactive':
							placement.status !== null && placement.status !== 'active',
					}}
					style={{ left: percent(placement.x), top: percent(placement.y) }}
					title={markerTitle(placement)}
					aria-label={markerTitle(placement)}
				>
					<Dynamic component={markerIcon(placement)} size={16} />
				</a>
			)}
		</For>
	)
}

/**
 * Page header and body of a floor plan: `title` with the Edit button, then
 * the plan or, while editing, the editor.
 */
export function FloorplanView(props: {
	attachment: AttachmentJson
	title: JSX.Element
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [plan, { mutate }] = createRecord(
		() => props.attachment.id,
		(id: number) => {
			setError(null)
			return fetch_floorplan(id)
		},
		setError,
	)
	const [editing, setEditing] = createSignal(false)
	const [actions, setActions] = createSignal<HTMLElement>()

	return (
		<>
			<div class="page-header">
				<h2>{props.title}</h2>
				{/* The editor puts Cancel / Save here, so the header keeps its height. */}
				<Show when={can('edit') && plan()}>
					<div class="form-actions" ref={setActions}>
						<Show when={!editing()}>
							<button type="button" onClick={() => setEditing(true)}>
								<IconLabel icon={IconPencil}>{t('floorplan.edit')}</IconLabel>
							</button>
						</Show>
					</div>
				</Show>
			</div>
			<Show when={!plan.loading} fallback={<Loading message={t('floorplan.loading')} />}>
				<Show when={plan()}>
					{(loaded: () => FloorplanJson) => (
						<Show
							when={!editing()}
							fallback={
								<FloorplanEditor
									attachment={props.attachment}
									plan={loaded()}
									on_saved={(saved: FloorplanJson) => {
										mutate(saved)
										setEditing(false)
									}}
									on_cancel={() => setEditing(false)}
									actions_mount={actions()}
								/>
							}
						>
							<div class="floorplan-view">
								<FloorplanStage attachment={props.attachment}>
									<AreaLayer areas={loaded().areas} />
									<MarkerLayer placements={loaded().placements} />
								</FloorplanStage>
							</div>
							<Show
								when={
									loaded().areas.length === 0 && loaded().placements.length === 0
								}
							>
								<p class="floorplan-hint">{t('floorplan.empty')}</p>
							</Show>
						</Show>
					)}
				</Show>
			</Show>
			<InlineError message={error()} />
		</>
	)
}
