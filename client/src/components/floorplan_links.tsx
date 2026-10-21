/**
 * Detail-grid rows linking to floor plans: the plans that reference an
 * object ("On floor plan of X" for a rack or device, "Linked from Y" for a
 * site or location) and the placed outlets a device is cabled to. They
 * render nothing while loading or when there are none; a failed lookup
 * reports to `onError`.
 */
import { For, type JSX, Show } from 'solid-js'
import {
	type FloorplanLinkJson,
	type FloorplanLinkTarget,
	type FloorplanOutletJson,
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

/**
 * Detail-grid row of the outlets a device's ports are cabled to and where
 * they sit: "eth0 → PP-A / 12 (floor plan of X)". Renders nothing without
 * placed outlets.
 */
export function OutletLinks(props: {
	outlets: FloorplanOutletJson[]
	/** Name of a local port by id. */
	portName: (ifaceId: number) => string | undefined
}): JSX.Element {
	return (
		<Show when={props.outlets.length > 0}>
			<dt>{t('floorplan.outlet')}</dt>
			<dd>
				<For each={props.outlets}>
					{(outlet: FloorplanOutletJson, index: () => number) => (
						<>
							<Show when={index() > 0}>{', '}</Show>
							<Show when={props.portName(outlet.local_interface_id)}>
								{(name: () => string) => (
									<>
										<code>{name()}</code>
										{' → '}
									</>
								)}
							</Show>
							<a href={`/devices/${outlet.port.device_id}`}>
								{outlet.port.device_name} / {outlet.port.name}
							</a>{' '}
							(<a href={`/floorplans/${outlet.attachment_id}`}>{outlet.owner_name}</a>
							)
						</>
					)}
				</For>
			</dd>
		</Show>
	)
}
