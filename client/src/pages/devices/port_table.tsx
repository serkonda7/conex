import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { createMemo, type JSX, Show } from 'solid-js'
import type { InterfaceJson } from '../../api/devices'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { t } from '../../i18n'
import { ComponentKind, componentGroups } from '../device_types/component_table'
import { componentClassOf } from '../device_types/components'
import { PortPeer } from './trace_peer'

/**
 * Ports of a device (no patch-panel ports) grouped by component class like
 * the device-type components, with kind glyph, cable peer and description.
 * Interfaces get their 1-based port number (creation order, eth1..ethN);
 * disabled ones are dimmed. `actions` renders the buttons of a row.
 */
export function DevicePortTable(props: {
	ports: InterfaceJson[]
	links: Map<number, TraceLink>
	endToEnd: (ifaceId: number) => TraceEndToEnd[]
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
	const columns: DataTableColumn<InterfaceJson>[] = [
		{
			key: 'name',
			label: t('common.name'),
			class: 'component-name',
			getValue: (iface: InterfaceJson): JSX.Element => (
				<>
					<span classList={{ 'text-muted': !iface.enabled }}>{iface.name}</span>
					<Show when={!iface.enabled}>
						{' '}
						<span class="badge">{t('device.disabled')}</span>
					</Show>
				</>
			),
		},
		{
			key: 'port',
			label: t('device.portNumber'),
			class: 'component-count',
			getValue: (iface: InterfaceJson): JSX.Element => portNumbers().get(iface.id) ?? '',
		},
		{
			key: 'kind',
			label: t('common.type'),
			getValue: (iface: InterfaceJson): JSX.Element => <ComponentKind kind={iface.kind} />,
		},
		{
			key: 'connection',
			label: t('device.connection'),
			getValue: (iface: InterfaceJson): JSX.Element => (
				<PortPeer link={props.links.get(iface.id)} endToEnd={props.endToEnd(iface.id)} />
			),
		},
		{
			key: 'description',
			label: t('common.description'),
			getValue: (iface: InterfaceJson): string => iface.description || '—',
		},
	]
	return (
		<DataTable
			class="component-table"
			columnLines
			rows={() => props.ports}
			getRowId={(iface: InterfaceJson): number => iface.id}
			columns={columns}
			showColumnCustomizer
			{...componentGroups<InterfaceJson>()}
			rowActions={props.actions}
		/>
	)
}
