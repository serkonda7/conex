/**
 * Read-only floor plan thumbnail for a detail page: the marked image capped in
 * height with the plan's areas and markers on top, one area optionally
 * highlighted (the page's own location). The whole preview links to the plan.
 * A small highlighted location is zoomed in on, so it stays recognizable.
 */
import { createMemo, For, type JSX } from 'solid-js'
import {
	type AttachmentJson,
	attachment_file_url,
	type FloorplanAreaJson,
	type FloorplanPlacementJson,
	fetch_floorplan,
} from '../api/attachments'
import { t } from '../i18n'
import { floorplanHref } from '../lib/floorplan_link'
import { createRecord, type ErrorSink } from '../lib/resource'
import { percent } from './floorplan_stage'

/** Highlighted areas narrower and shorter than this (plan fraction) are zoomed in on. */
const ZOOM_BELOW = 0.3
/** Plan fraction the zoomed-in location spans along its larger side. */
const ZOOM_TARGET = 0.4
const MAX_ZOOM = 3

interface Zoom {
	scale: number
	/** Top-left corner of the visible window, in plan fractions. */
	x: number
	y: number
}

/** Visible window start along one axis: centred on the area, kept inside the plan. */
function windowStart(min: number, max: number, scale: number): number {
	const span = 1 / scale
	return Math.min(Math.max((min + max) / 2 - span / 2, 0), 1 - span)
}

/** Zoom onto the union of the areas when it is small; undefined shows the whole plan. */
function zoomFor(areas: FloorplanAreaJson[]): Zoom | undefined {
	const points = areas.flatMap((area) => area.points)
	if (points.length === 0) {
		return undefined
	}
	const xs = points.map(([x]) => x)
	const ys = points.map(([, y]) => y)
	const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
	const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
	const extent = Math.max(maxX - minX, maxY - minY)
	if (extent >= ZOOM_BELOW) {
		return undefined
	}
	const scale = Math.min(MAX_ZOOM, ZOOM_TARGET / Math.max(extent, Number.EPSILON))
	return {
		scale,
		x: windowStart(minX, maxX, scale),
		y: windowStart(minY, maxY, scale),
	}
}

export function FloorplanPreview(props: {
	attachment: AttachmentJson
	/** Location whose areas are highlighted. */
	highlight?: number
	onError?: ErrorSink
}): JSX.Element {
	const [plan] = createRecord(() => props.attachment.id, fetch_floorplan, props.onError)
	const isCurrent = (area: FloorplanAreaJson): boolean =>
		props.highlight !== undefined && area.location_id === props.highlight
	const zoom = createMemo(() => zoomFor((plan()?.areas ?? []).filter(isCurrent)))
	const canvasStyle = (): JSX.CSSProperties => {
		const z = zoom()
		return z
			? {
					'--zoom': String(z.scale),
					transform: `translate(${-z.x * z.scale * 100}%, ${-z.y * z.scale * 100}%) scale(${z.scale})`,
				}
			: {}
	}
	return (
		<a
			class="floorplan-preview"
			href={floorplanHref(
				props.attachment.id,
				props.highlight === undefined ? undefined : { location: props.highlight },
			)}
			aria-label={t('floorplan.open')}
			draggable={false}
		>
			<div class="floorplan-preview-canvas" style={canvasStyle()}>
				<img src={attachment_file_url(props.attachment)} alt="" draggable={false} />
				<svg
					class="floorplan-overlay"
					viewBox="0 0 1 1"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					<For each={plan()?.areas ?? []}>
						{(area: FloorplanAreaJson) => (
							<polygon
								class="floorplan-preview-area"
								classList={{ current: isCurrent(area) }}
								points={area.points.map((point) => point.join(',')).join(' ')}
							/>
						)}
					</For>
				</svg>
				<For each={plan()?.placements ?? []}>
					{(placement: FloorplanPlacementJson) => (
						<span
							class="floorplan-preview-dot"
							classList={{ rack: placement.rack_id !== null }}
							style={{ left: percent(placement.x), top: percent(placement.y) }}
							aria-hidden="true"
						/>
					)}
				</For>
			</div>
		</a>
	)
}
