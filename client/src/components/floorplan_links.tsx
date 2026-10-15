/**
 * Detail-grid row listing the floor plans that reference an object: "On
 * floor plan of X" for a rack or device, "Linked from Y" for a site or
 * location. Renders nothing while loading or when there are none; a failed
 * lookup reports to `onError`.
 */
import { For, type JSX, Show } from 'solid-js'
import {
	type FloorplanLinkJson,
	type FloorplanLinkTarget,
	fetch_floorplan_links,
} from '../api/attachments'
import { type MessageKey, t } from '../i18n'
import { createRowsFor, type ErrorSink } from '../lib/resource'

export function FloorplanLinks(props: {
	target: FloorplanLinkTarget
	label: MessageKey
	onError?: ErrorSink
}): JSX.Element {
	const [links] = createRowsFor(() => props.target, fetch_floorplan_links, props.onError)
	return (
		<Show when={(links() ?? []).length > 0}>
			<dt>{t(props.label)}</dt>
			<dd>
				<For each={links()}>
					{(link: FloorplanLinkJson, index: () => number) => (
						<>
							<Show when={index() > 0}>{', '}</Show>
							<a href={`/floorplans/${link.attachment_id}`}>{link.owner_name}</a>
						</>
					)}
				</For>
			</dd>
		</Show>
	)
}
