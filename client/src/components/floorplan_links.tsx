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

/** Link to the owner's detail page at its floor plan. */
function planHref(link: FloorplanLinkJson): string {
	return link.site_id !== null
		? `/sites/${link.site_id}#floorplan`
		: `/locations/${link.location_id}#floorplan`
}

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
							<a href={planHref(link)}>{link.owner_name}</a>
						</>
					)}
				</For>
			</dd>
		</Show>
	)
}
