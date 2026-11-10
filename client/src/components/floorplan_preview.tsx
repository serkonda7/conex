/**
 * Read-only floor plan thumbnail for a detail page: the marked image capped in
 * height with the plan's areas and markers on top, one area optionally
 * highlighted (the page's own location). The whole preview links to the plan.
 */
import { For, type JSX } from 'solid-js'
import {
	type AttachmentJson,
	attachment_file_url,
	type FloorplanAreaJson,
	type FloorplanPlacementJson,
	fetch_floorplan,
} from '../api/attachments'
import { t } from '../i18n'
import { createRecord, type ErrorSink } from '../lib/resource'
import { percent } from './floorplan_stage'

export function FloorplanPreview(props: {
	attachment: AttachmentJson
	/** Location whose areas are highlighted. */
	highlight?: number
	onError?: ErrorSink
}): JSX.Element {
	const [plan] = createRecord(() => props.attachment.id, fetch_floorplan, props.onError)
	const isCurrent = (area: FloorplanAreaJson): boolean =>
		props.highlight !== undefined && area.location_id === props.highlight
	return (
		<a
			class="floorplan-preview"
			href={`/floorplans/${props.attachment.id}`}
			aria-label={t('floorplan.open')}
			draggable={false}
		>
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
		</a>
	)
}
