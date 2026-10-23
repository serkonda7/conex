import type {
	TraceEndToEnd,
	TraceLink,
	TracePanelPass,
	TracePeerDevice,
	TracePeerInterface,
} from 'shared/src/types'
import { For, type JSX, Show } from 'solid-js'
import { t } from '../../i18n'

/** `PP-A 12`, or `CB MPO→LC2` when the signal leaves by a port of another name. */
export function panelPassLabel(pass: TracePanelPass): string {
	const out = pass.out_interface
	const ports =
		out && out.name !== pass.in_interface.name
			? `${pass.in_interface.name}→${out.name}`
			: pass.in_interface.name
	return `${pass.device.name} ${ports}`
}

/** "→ PC-123: eth0 via PP-A 12 · PP-B 12" (or "ends at a free port" inside a panel). */
export function EndToEndPeer(props: { peer: TraceEndToEnd }): JSX.Element {
	const via = (): string => props.peer.via.map(panelPassLabel).join(' · ')
	return (
		<span class="trace-end-to-end">
			<Show
				when={props.peer.end_device}
				fallback={<span class="panel-port-muted">{t('device.trace.openEnd')}</span>}
			>
				{(end: () => TracePeerDevice): JSX.Element => (
					<>
						<a href={`/devices/${end().id}`}>{end().name}</a>
						<Show when={props.peer.end_interface}>
							{(port: () => TracePeerInterface): JSX.Element => (
								<>
									{' '}
									<code class="peer-port">{port().name}</code>
								</>
							)}
						</Show>
					</>
				)}
			</Show>{' '}
			<small>
				{t('device.trace.via', { via: via() })}
				<Show when={props.peer.split}> {t('device.trace.split')}</Show>
			</small>
		</span>
	)
}

/**
 * Cable peer of a port: the direct peer, and behind patch panels the
 * end-to-end peers underneath.
 */
export function PortPeer(props: {
	link: TraceLink | undefined
	endToEnd: TraceEndToEnd[]
}): JSX.Element {
	return (
		<Show when={props.link} fallback={<span>—</span>}>
			{(link: () => TraceLink): JSX.Element => (
				<span class="port-peer">
					<span>
						<a href={`/devices/${link().peer_device.id}`}>{link().peer_device.name}</a>{' '}
						<code class="peer-port">{link().peer_interface.name}</code>
					</span>
					<For each={props.endToEnd}>
						{(peer: TraceEndToEnd): JSX.Element => <EndToEndPeer peer={peer} />}
					</For>
				</span>
			)}
		</Show>
	)
}
