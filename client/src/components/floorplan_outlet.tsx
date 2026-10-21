/**
 * Popover of an outlet marker (a patch-panel rear port on a floor plan):
 * the circuit through the panel, i.e. what its front port is cabled to
 * (switch side, through further panels) and what the outlet itself is
 * cabled to (end device), plus a connect action for a free outlet.
 */
import { IconX } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { createResource, createSignal, type JSX, Show } from 'solid-js'
import type { FloorplanPlacementJson, FloorplanPortJson } from '../api/attachments'
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
	interface_id: number
}

/** True when a placement is an outlet. */
export function isOutlet(placement: FloorplanPlacementJson): placement is OutletPlacement {
	return placement.port !== null && placement.interface_id !== null
}

/** The outlet, its paired front port (position 1) and the panel's cable peers. */
interface OutletCircuit {
	rear: InterfaceJson | undefined
	front: InterfaceJson | undefined
	links: Map<number, TraceLink>
	endToEnd: (ifaceId: number | undefined) => TraceEndToEnd[]
}

export function OutletPopover(props: {
	placement: OutletPlacement
	on_changed: () => void
	on_close: () => void
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [connecting, setConnecting] = createSignal<InterfaceJson | null>(null)
	const panelId = (): number => props.placement.port.device_id

	const [circuit, { refetch }] = createResource(
		panelId,
		async (id: number): Promise<OutletCircuit | undefined> => {
			const [ports, trace] = await Promise.all([fetch_interfaces(id), fetch_trace(id, 1)])
			if (Result.isError(ports)) {
				setError(ports.error.message)
				return undefined
			}
			const rear = ports.value.find((p) => p.id === props.placement.interface_id)
			const front = ports.value.find(
				(p) =>
					p.side === 'front' && p.rear_port_id === rear?.id && p.rear_port_position === 1,
			)
			const value = Result.isError(trace) ? undefined : trace.value
			return {
				rear,
				front,
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
					aria-label={t('floorplan.closePopover')}
					title={t('floorplan.closePopover')}
					onClick={props.on_close}
				>
					<IconX size={14} />
				</button>
			</div>
			<Show when={!circuit.loading} fallback={<Loading message={t('common.loading')} />}>
				<Show when={circuit()}>
					{(loaded: () => OutletCircuit) => (
						<>
							<dl class="floorplan-popover-trace">
								<dt>{t('floorplan.outletSwitchSide')}</dt>
								<dd>
									<PortPeer
										link={
											loaded().front
												? loaded().links.get(loaded().front?.id ?? 0)
												: undefined
										}
										endToEnd={loaded().endToEnd(loaded().front?.id)}
									/>
								</dd>
								<dt>{t('floorplan.outletDeviceSide')}</dt>
								<dd>
									<PortPeer
										link={loaded().links.get(props.placement.interface_id)}
										endToEnd={loaded().endToEnd(props.placement.interface_id)}
									/>
								</dd>
							</dl>
							<div class="floorplan-popover-actions">
								<Show
									when={can('edit') && loaded().rear && !loaded().rear?.connected}
								>
									<button
										type="button"
										onClick={() => setConnecting(loaded().rear ?? null)}
									>
										{t('device.connect')}
									</button>
								</Show>
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
							props.on_changed()
						}}
						on_close={() => setConnecting(null)}
					/>
				)}
			</Show>
		</div>
	)
}
