import { IconLinkPlus, IconUnlink } from '@tabler/icons-solidjs'
import type { PoeType } from 'shared/src/schemas'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { createMemo, type JSX, Show } from 'solid-js'
import type { DevicePortJson, InterfaceJson } from '../../api/devices'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { t } from '../../i18n'
import { poeTypeLabel, poeTypeShortLabel } from '../../i18n/labels'
import { ComponentKind, componentGroups } from '../device_types/component_table'
import { componentClassOf } from '../device_types/components'
import { PortPeer } from './trace_peer'

/**
 * Ports of a device (no patch-panel ports) grouped by component class like
 * the device-type components, with kind glyph and cable peer.
 * Interfaces get their 1-based port number (creation order, eth1..ethN);
 * disabled ones carry a pill before it and dim their name and type. The type
 * adds the PoE type of the port's device-type stub when set. Unconnected
 * enabled ports get a connect button on row hover (`onConnect`), connected
 * ones a disconnect button (`onDisconnect`); `actions`
 * renders the buttons of a row.
 */
export function DevicePortTable(props: {
	ports: DevicePortJson[]
	links: Map<number, TraceLink>
	endToEnd: (ifaceId: number) => TraceEndToEnd[]
	/** Connects an unconnected port; no button without it. */
	onConnect?: (iface: InterfaceJson) => void
	/** Removes the cable of a connected port; no button without it. */
	onDisconnect?: (link: TraceLink) => void
	actions?: (iface: InterfaceJson) => JSX.Element
}): JSX.Element {
	const portNumbers = createMemo(
		() =>
			new Map(
				props.ports
					.filter((iface) => componentClassOf(iface) === 'interface')
					.map((iface, index) => [iface.id, index + 1]),
			),
	)
	const columns: DataTableColumn<DevicePortJson>[] = [
		{
			key: 'port',
			label: t('device.portNumber'),
			class: 'component-count',
			getValue: (iface: DevicePortJson): JSX.Element => (
				<>
					<Show when={!iface.enabled}>
						<span class="badge">{t('device.disabled')}</span>{' '}
					</Show>
					{portNumbers().get(iface.id) ?? ''}
				</>
			),
		},
		{
			key: 'name',
			label: t('common.name'),
			class: 'component-name',
			getValue: (iface: DevicePortJson): JSX.Element => (
				<span classList={{ 'text-muted': !iface.enabled }}>{iface.name}</span>
			),
		},
		{
			key: 'connection',
			label: t('device.connection'),
			getValue: (iface: DevicePortJson): JSX.Element => (
				<Show
					when={props.links.get(iface.id) || iface.enabled}
					fallback={<span class="text-muted">—</span>}
				>
					<span class="panel-port-cell">
						<PortPeer
							link={props.links.get(iface.id)}
							endToEnd={props.endToEnd(iface.id)}
						/>
						<Show when={props.onConnect && !iface.connected}>
							<button
								type="button"
								class="icon-btn icon-btn-connect"
								title={t('device.connectToPeer', { name: iface.name })}
								aria-label={t('device.connectCableFor', { name: iface.name })}
								onClick={(): void => props.onConnect?.(iface)}
							>
								<IconLinkPlus size={20} />
							</button>
						</Show>
						<Show when={props.onDisconnect ? props.links.get(iface.id) : undefined}>
							{(link: () => TraceLink): JSX.Element => (
								<button
									type="button"
									class="icon-btn icon-btn-danger icon-btn-disconnect"
									title={t('device.disconnectPort', { name: iface.name })}
									aria-label={t('device.disconnectPort', { name: iface.name })}
									onClick={(): void => props.onDisconnect?.(link())}
								>
									<IconUnlink size={20} />
								</button>
							)}
						</Show>
					</span>
				</Show>
			),
		},
		{
			key: 'kind',
			label: t('common.type'),
			getValue: (iface: DevicePortJson): JSX.Element => (
				<span classList={{ 'component-kind': true, 'text-muted': !iface.enabled }}>
					<ComponentKind kind={iface.kind} />
					<Show when={iface.poe_type}>
						{(poe: () => PoeType): JSX.Element => (
							<span title={poeTypeLabel(poe())}>{poeTypeShortLabel(poe())}</span>
						)}
					</Show>
				</span>
			),
		},
	]
	return (
		<DataTable
			class="component-table device-port-table"
			columnLines
			rows={() => props.ports}
			getRowId={(iface: DevicePortJson): number => iface.id}
			columns={columns}
			showColumnCustomizer
			{...componentGroups<DevicePortJson>()}
			rowActions={props.actions}
		/>
	)
}
