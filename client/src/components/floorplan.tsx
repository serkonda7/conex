/**
 * Floor plan of a site or location: its marked image at fit-to-width with
 * the plan's areas and markers on top. Coordinates are normalized to 0..1,
 * so the overlay scales with the image: areas are polygons in an SVG with
 * `viewBox="0 0 1 1"` stretched over it, labels and markers are positioned
 * in percent. An area links to its target's own floor plan (`#floorplan`),
 * so plans drill down site → floor → room; a marker links to its rack or
 * device.
 *
 * The stage and its layers are separate pieces so an edit mode can swap the
 * view layers for editable ones on the same stage.
 */
import { IconBox, IconServer } from '@tabler/icons-solidjs'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import {
	type AttachmentJson,
	attachment_file_url,
	type FloorplanAreaJson,
	type FloorplanJson,
	type FloorplanPlacementJson,
	fetch_floorplan,
} from '../api/attachments'
import { t, tp } from '../i18n'
import { deviceStatusLabel } from '../i18n/labels'
import { deviceRoleIcon, type IconComponent } from '../lib/icons'
import { createRecord } from '../lib/resource'
import { goTo, useAnchorScroll } from '../lib/router'
import { InlineError, Loading } from './feedback'

/** Percent offset of a normalized coordinate, for `left` / `top`. */
function percent(value: number): string {
	return `${value * 100}%`
}

/** Display name of an area: its label, else its target's name. */
function areaName(area: FloorplanAreaJson): string {
	return area.label || area.target_name
}

/** The area's target page, scrolled to its own floor plan. */
function areaHref(area: FloorplanAreaJson): string {
	return area.site_id !== null
		? `/sites/${area.site_id}#floorplan`
		: `/locations/${area.location_id}#floorplan`
}

/** Label anchor of an area: the center of its bounding box. */
function areaCenter(area: FloorplanAreaJson): { x: number; y: number } {
	const xs = area.points.map((point) => point[0])
	const ys = area.points.map((point) => point[1])
	return {
		x: (Math.min(...xs) + Math.max(...xs)) / 2,
		y: (Math.min(...ys) + Math.max(...ys)) / 2,
	}
}

function markerHref(placement: FloorplanPlacementJson): string {
	return placement.rack_id !== null
		? `/racks/${placement.rack_id}`
		: `/devices/${placement.device_id}`
}

/** Rack glyph for racks, the role glyph for devices (a generic one without). */
function markerIcon(placement: FloorplanPlacementJson): IconComponent {
	if (placement.rack_id !== null) {
		return IconBox
	}
	return deviceRoleIcon(placement.role_icon) ?? IconServer
}

/** Tooltip of a marker: the name with the device status, or "Rack". */
function markerTitle(placement: FloorplanPlacementJson): string {
	const detail =
		placement.status !== null ? deviceStatusLabel(placement.status) : tp('entity.rack', 1)
	return t('floorplan.markerTitle', { name: placement.name, detail })
}

/** The image at fit-to-width with the overlay layers (`children`) on top. */
function FloorplanStage(props: { attachment: AttachmentJson; children: JSX.Element }): JSX.Element {
	return (
		<div class="floorplan-stage">
			<img
				src={attachment_file_url(props.attachment)}
				alt={t('floorplan.image', {
					name: props.attachment.description || props.attachment.filename,
				})}
				width={props.attachment.width_px}
				height={props.attachment.height_px}
			/>
			{props.children}
		</div>
	)
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
 * "Floor plan" section of a site or location detail page, shown while one
 * of its images is marked as the floor plan. `id` is the heading anchor; a
 * route ending in `#<id>` scrolls here once the plan has loaded.
 */
export function FloorplanSection(props: {
	id: string
	attachment: AttachmentJson | undefined
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [plan] = createRecord(
		() => props.attachment?.id,
		(id: number) => {
			setError(null)
			return fetch_floorplan(id)
		},
		setError,
	)
	const [heading, setHeading] = createSignal<HTMLElement>()
	useAnchorScroll(props.id, () => (plan.loading ? undefined : heading()))

	return (
		<Show when={props.attachment}>
			{(attachment: () => AttachmentJson) => (
				<>
					<div class="section-header">
						<h3 id={props.id} class="floorplan-heading" ref={setHeading}>
							{t('floorplan.title')}
						</h3>
					</div>
					<Show
						when={!plan.loading}
						fallback={<Loading message={t('floorplan.loading')} />}
					>
						<Show when={plan()}>
							{(loaded: () => FloorplanJson) => (
								<>
									<FloorplanStage attachment={attachment()}>
										<AreaLayer areas={loaded().areas} />
										<MarkerLayer placements={loaded().placements} />
									</FloorplanStage>
									<Show
										when={
											loaded().areas.length === 0 &&
											loaded().placements.length === 0
										}
									>
										<p class="floorplan-hint">{t('floorplan.empty')}</p>
									</Show>
								</>
							)}
						</Show>
					</Show>
					<InlineError message={error()} />
				</>
			)}
		</Show>
	)
}
