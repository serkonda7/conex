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
 * stage. Beside the stage, the object list reaches every area and marker.
 */
import { IconPencil } from '@tabler/icons-solidjs'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
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
import { areaLayer, LayerBar, layerVisible, markerLayer } from './floorplan_layers'
import { focusObject, ObjectList, type PlanObject, sameObject } from './floorplan_objects'
import { isOutlet, type OutletPlacement, OutletPopover } from './floorplan_outlet'
import {
	areaCenter,
	areaName,
	createStageZoom,
	declutter,
	FloorplanStage,
	type MarkerCluster,
	markerClasses,
	markerIcon,
	markerTitle,
	percent,
	type ShownMarker,
	type StageZoom,
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
	if (placement.port) {
		return `/devices/${placement.port.device_id}`
	}
	return placement.rack_id !== null
		? `/racks/${placement.rack_id}`
		: `/devices/${placement.device_id}`
}

/**
 * Area polygons with their labels. The polygons react to the pointer only;
 * the label is the focusable link of each area.
 */
function AreaLayer(props: {
	areas: FloorplanAreaJson[]
	selected: PlanObject | null
}): JSX.Element {
	const isSelected = (area: FloorplanAreaJson): boolean =>
		sameObject(props.selected, { kind: 'area', id: area.id })
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
							class={`floorplan-area floorplan-layer-${areaLayer(area)}`}
							classList={{ selected: isSelected(area) }}
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
						classList={{ selected: isSelected(area) }}
						style={{
							left: percent(areaCenter(area).x),
							top: percent(areaCenter(area).y),
						}}
						draggable={false}
						aria-label={t('floorplan.openArea', { name: areaName(area) })}
					>
						{areaName(area)}
					</a>
				)}
			</For>
		</>
	)
}

/**
 * Rack, device and outlet markers; the tooltip names the object and its
 * status. An outlet opens its popover (trace and connect) instead of a link.
 * Markers too close to tell apart merge into a count bubble that zooms in;
 * at full zoom they spread around it instead.
 */
function MarkerLayer(props: {
	placements: FloorplanPlacementJson[]
	zoom: StageZoom
	selected: PlanObject | null
}): JSX.Element {
	const [open, setOpen] = createSignal<number | null>(null)
	const openOutlet = (): OutletPlacement | undefined => {
		const found = props.placements.find((p: FloorplanPlacementJson) => p.id === open())
		return found && isOutlet(found) ? found : undefined
	}
	const selectedId = (): number | null =>
		props.selected?.kind === 'marker' ? props.selected.id : null
	const shown = createMemo(() => declutter(props.placements, props.zoom, selectedId() ?? open()))
	const style = (item: ShownMarker): JSX.CSSProperties => ({
		left: percent(item.x),
		top: percent(item.y),
		'--floorplan-dx': `${item.dx}px`,
		'--floorplan-dy': `${item.dy}px`,
	})
	return (
		<>
			<For each={shown().markers}>
				{(item: ShownMarker) => (
					<Show
						when={isOutlet(item.placement)}
						fallback={
							<a
								href={markerHref(item.placement)}
								class="floorplan-marker"
								classList={{
									...markerClasses(item.placement),
									selected: selectedId() === item.placement.id,
								}}
								style={style(item)}
								draggable={false}
								title={markerTitle(item.placement)}
								aria-label={markerTitle(item.placement)}
							>
								<Dynamic component={markerIcon(item.placement)} size={16} />
							</a>
						}
					>
						<button
							type="button"
							class="floorplan-marker"
							classList={{
								...markerClasses(item.placement),
								selected: selectedId() === item.placement.id,
							}}
							style={style(item)}
							title={markerTitle(item.placement)}
							aria-label={markerTitle(item.placement)}
							aria-expanded={open() === item.placement.id}
							onClick={() =>
								setOpen(open() === item.placement.id ? null : item.placement.id)
							}
						>
							<Dynamic component={markerIcon(item.placement)} size={14} />
						</button>
					</Show>
				)}
			</For>
			<For each={shown().clusters}>
				{(cluster: MarkerCluster) => <ClusterBubble cluster={cluster} zoom={props.zoom} />}
			</For>
			<Show when={openOutlet()}>
				{(placement: () => OutletPlacement) => (
					<OutletPopover placement={placement()} on_close={() => setOpen(null)} />
				)}
			</Show>
		</>
	)
}

/** Count bubble of a marker cluster; a click zooms in on its members. */
function ClusterBubble(props: { cluster: MarkerCluster; zoom: StageZoom }): JSX.Element {
	const label = (): string =>
		t('floorplan.clusterZoom', {
			count: props.cluster.members.length,
			names: props.cluster.members.map((p: FloorplanPlacementJson) => p.name).join(', '),
		})
	return (
		<button
			type="button"
			class="floorplan-cluster"
			style={{ left: percent(props.cluster.x), top: percent(props.cluster.y) }}
			title={label()}
			aria-label={label()}
			onPointerDown={(e: PointerEvent) => e.stopPropagation()}
			onClick={() => {
				const xs = props.cluster.members.map((p: FloorplanPlacementJson) => p.x)
				const ys = props.cluster.members.map((p: FloorplanPlacementJson) => p.y)
				props.zoom.focus(
					{
						x0: Math.min(...xs),
						y0: Math.min(...ys),
						x1: Math.max(...xs),
						y1: Math.max(...ys),
					},
					props.zoom.scale() * 2,
				)
			}}
		>
			{props.cluster.members.length}
		</button>
	)
}

/** The read-only plan: layer bar, zoomable stage and the object list beside it. */
function PlanViewer(props: { attachment: AttachmentJson; plan: FloorplanJson }): JSX.Element {
	const zoom = createStageZoom()
	const [selected, setSelected] = createSignal<PlanObject | null>(null)
	const [search, setSearch] = createSignal('')
	const areas = (): FloorplanAreaJson[] =>
		props.plan.areas.filter((area: FloorplanAreaJson) => layerVisible(areaLayer(area)))
	const placements = (): FloorplanPlacementJson[] =>
		props.plan.placements.filter((p: FloorplanPlacementJson) => layerVisible(markerLayer(p)))
	return (
		<div class="floorplan-layout">
			<div>
				<LayerBar
					areas={props.plan.areas}
					placements={props.plan.placements}
					empty_hint={t('floorplan.empty')}
				/>
				<FloorplanStage attachment={props.attachment} zoom={zoom}>
					<AreaLayer areas={areas()} selected={selected()} />
					<MarkerLayer placements={placements()} zoom={zoom} selected={selected()} />
				</FloorplanStage>
			</div>
			<aside class="floorplan-palette" aria-label={t('floorplan.objects')}>
				<h4>{t('floorplan.objects')}</h4>
				<input
					type="search"
					class="floorplan-palette-search"
					placeholder={t('floorplan.objectSearch')}
					aria-label={t('floorplan.objectSearch')}
					value={search()}
					onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
						setSearch(e.currentTarget.value)
					}
				/>
				<ObjectList
					areas={props.plan.areas}
					placements={props.plan.placements}
					search={search()}
					selected={selected()}
					on_select={(object: PlanObject) => {
						setSelected(object)
						focusObject(zoom, object, props.plan.areas, props.plan.placements)
					}}
				/>
			</aside>
		</div>
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
							<PlanViewer attachment={props.attachment} plan={loaded()} />
						</Show>
					)}
				</Show>
			</Show>
			<InlineError message={error()} />
		</>
	)
}
