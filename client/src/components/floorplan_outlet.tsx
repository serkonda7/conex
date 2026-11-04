/**
 * Popover of an outlet marker (a patch-panel rear port, or a jack of
 * several, on a floor plan): per port the circuit through the panel, i.e.
 * what its front port is cabled to (switch side, through further panels)
 * and what the port itself is cabled to (end device), plus a connect
 * action for a free port.
 */
import { IconX } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { createResource, createSignal, For, type JSX, Show } from 'solid-js'
import type {
	FloorplanOutletPortJson,
	FloorplanPlacementJson,
	FloorplanPortJson,
} from '../api/attachments'
import { fetch_trace } from '../api/cables'
import { fetch_interfaces, type InterfaceJson } from '../api/devices'
import { t } from '../i18n'
import { can } from '../lib/session'
import { ConnectPortDialog } from '../pages/devices/connect_port_dialog'
import { PortPeer } from '../pages/devices/trace_peer'
import { InlineError, Loading } from './feedback'
import { percent } from './floorplan_stage'

/** An outlet placement: its port details are set. */
export type OutletPlacement = FloorplanPlacementJson & {
	port: FloorplanPortJson
}

/** True when a placement is an outlet (a rear port or a jack). */
export function isOutlet(placement: FloorplanPlacementJson): placement is OutletPlacement {
	return placement.port !== null
}

/** The outlet's panel ports and cable peers. */
interface OutletCircuit {
	ports: InterfaceJson[]
	links: Map<number, TraceLink>
	endToEnd: (ifaceId: number | undefined) => TraceEndToEnd[]
}

export function OutletPopover(props: {
	placement: OutletPlacement
	on_close: () => void
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [connecting, setConnecting] = createSignal<InterfaceJson | null>(null)
	const panelId = (): number => props.placement.port.device_id
	const isJack = (): boolean => props.placement.port.ports.length > 1

	const [circuit, { refetch }] = createResource(
		panelId,
		async (id: number): Promise<OutletCircuit | undefined> => {
			const [ports, trace] = await Promise.all([fetch_interfaces(id), fetch_trace(id, 1)])
			if (Result.isError(ports)) {
				setError(ports.error.message)
				return undefined
			}
			const value = Result.isError(trace) ? undefined : trace.value
			return {
				ports: ports.value,
				links: new Map((value?.links ?? []).map((link) => [link.local_interface.id, link])),
				endToEnd: (ifaceId: number | undefined): TraceEndToEnd[] =>
					(value?.end_to_end ?? []).filter((peer) => peer.local_interface_id === ifaceId),
			}
		},
	)

	return (
		<div
			class="floorplan-popover"
			style={{ left: percent(props.placement.x), top: percent(props.placement.y) }}
			role="dialog"
			aria-label={props.placement.name}
		>
			<div class="floorplan-popover-header">
				<strong>{props.placement.name}</strong>
				<button
					type="button"
					class="icon-btn"
					aria-label={t('common.close')}
					title={t('common.close')}
					onClick={props.on_close}
				>
					<IconX size={14} />
				</button>
			</div>
			<Show when={!circuit.loading} fallback={<Loading message={t('common.loading')} />}>
				<Show when={circuit()}>
					{(loaded: () => OutletCircuit) => (
						<>
							<For each={props.placement.port.ports}>
								{(item: FloorplanOutletPortJson) => {
									const rear = (): InterfaceJson | undefined =>
										loaded().ports.find((p) => p.id === item.id)
									/** Front port on the rear port's (only) position. */
									const front = (): InterfaceJson | undefined =>
										loaded().ports.find(
											(p) =>
												p.side === 'front' &&
												p.rear_port_id === item.id &&
												p.rear_port_position === 1,
										)
									return (
										<section class="floorplan-popover-port">
											<Show when={isJack()}>
												<h4>
													<code>{item.name}</code>
												</h4>
											</Show>
											<dl class="floorplan-popover-trace">
												<dt>{t('floorplan.outletSwitchSide')}</dt>
												<dd>
													<PortPeer
														link={
															front()
																? loaded().links.get(
																		front()?.id ?? 0,
																	)
																: undefined
														}
														endToEnd={loaded().endToEnd(front()?.id)}
													/>
												</dd>
												<dt>{t('floorplan.outletDeviceSide')}</dt>
												<dd>
													<PortPeer
														link={loaded().links.get(item.id)}
														endToEnd={loaded().endToEnd(item.id)}
													/>
												</dd>
											</dl>
											<Show
												when={
													can('edit') &&
													rear()?.patched &&
													!rear()?.connected
												}
											>
												<div class="floorplan-popover-actions">
													<button
														type="button"
														onClick={() =>
															setConnecting(rear() ?? null)
														}
													>
														{isJack()
															? t('device.connectCableFor', {
																	name: item.name,
																})
															: t('device.connect')}
													</button>
												</div>
											</Show>
										</section>
									)
								}}
							</For>
							<div class="floorplan-popover-actions">
								<a href={`/devices/${panelId()}`}>{t('floorplan.openPanel')}</a>
							</div>
						</>
					)}
				</Show>
			</Show>
			<InlineError message={error()} />
			<Show when={connecting()}>
				{(iface: () => InterfaceJson) => (
					<ConnectPortDialog
						iface={iface()}
						on_connected={() => {
							setConnecting(null)
							void refetch()
						}}
						on_close={() => setConnecting(null)}
					/>
				)}
			</Show>
		</div>
	)
}
