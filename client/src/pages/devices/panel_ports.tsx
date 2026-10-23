import { IconLinkPlus } from '@tabler/icons-solidjs'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { createMemo, type JSX, Show } from 'solid-js'
import type { InterfaceJson } from '../../api/devices'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { t } from '../../i18n'
import { PortPeer } from './trace_peer'

/**
 * One row of the patch-panel table: a single-position rear port with its
 * front port, or a multi-position rear port (`position` null) followed by
 * one row per position with the front port mapped there.
 */
interface PanelRow {
	key: string
	/** 1-based rear port number. */
	number: number
	rear: InterfaceJson
	front: InterfaceJson | null
	/** Position row of a multi-position rear port. */
	position: number | null
}

/** Rows of all rear ports, in creation order. */
export function panelRowsOf(ports: InterfaceJson[]): PanelRow[] {
	const frontBySlot = new Map<string, InterfaceJson>()
	for (const port of ports) {
		if (port.side === 'front' && port.rear_port_id !== null) {
			frontBySlot.set(`${port.rear_port_id}:${port.rear_port_position ?? 1}`, port)
		}
	}
	const rows: PanelRow[] = []
	for (const [index, rear] of ports.filter((p) => p.side === 'rear').entries()) {
		const number = index + 1
		if (rear.positions === 1) {
			rows.push({
				key: `${rear.id}`,
				number,
				rear,
				front: frontBySlot.get(`${rear.id}:1`) ?? null,
				position: null,
			})
			continue
		}
		rows.push({ key: `${rear.id}`, number, rear, front: null, position: null })
		for (let position = 1; position <= rear.positions; position += 1) {
			rows.push({
				key: `${rear.id}:${position}`,
				number,
				rear,
				front: frontBySlot.get(`${rear.id}:${position}`) ?? null,
				position,
			})
		}
	}
	return rows
}

/**
 * Patch-panel ports grouped by rear port: `# | Front → peer | Rear (outlet)
 * → peer`, plus `extraColumns` (floor plan). Multi-position rear ports
 * list their positions underneath. Unconnected ports get a connect button
 * (`onConnect`); `rowActions` (one edit button) edits both ports of a row.
 */
export function PanelPortTable(props: {
	ports: InterfaceJson[]
	links: Map<number, TraceLink>
	endToEnd: (ifaceId: number) => TraceEndToEnd[]
	/** Connects an unconnected port; no button without it. */
	onConnect?: (iface: InterfaceJson) => void
	rowActions?: (row: PanelRow) => JSX.Element
	extraColumns?: DataTableColumn<PanelRow>[]
}): JSX.Element {
	const rows = createMemo(() => panelRowsOf(props.ports))

	const portCell = (iface: InterfaceJson | null): JSX.Element => {
		if (!iface) {
			return <span>—</span>
		}
		return (
			<span class="panel-port-cell">
				<code>{iface.name}</code>
				<PortPeer link={props.links.get(iface.id)} endToEnd={props.endToEnd(iface.id)} />
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
			</span>
		)
	}

	const columns = (): DataTableColumn<PanelRow>[] => [
		{
			key: 'number',
			label: '#',
			getValue: (row: PanelRow): string =>
				row.position === null ? String(row.number) : `↳ ${row.position}`,
		},
		{
			key: 'front',
			label: t('device.panel.front'),
			getValue: (row: PanelRow): JSX.Element =>
				row.position === null && row.rear.positions > 1 ? (
					<span class="panel-port-muted">
						{t('device.panel.positions', { count: row.rear.positions })}
					</span>
				) : (
					portCell(row.front)
				),
		},
		{
			key: 'rear',
			label: t('device.panel.rear'),
			getValue: (row: PanelRow): JSX.Element =>
				row.position === null ? portCell(row.rear) : <span />,
		},
		...(props.extraColumns ?? []),
	]

	return (
		<DataTable
			rows={rows}
			getRowId={(row: PanelRow): string => row.key}
			showColumnCustomizer
			columns={columns()}
			rowActions={props.rowActions}
			empty={false}
		/>
	)
}

export type { PanelRow }
