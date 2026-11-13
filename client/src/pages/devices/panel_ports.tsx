import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { createComputed, createMemo, type JSX } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { InterfaceJson } from '../../api/devices'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { t } from '../../i18n'
import { CableButtons } from './port_table'
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
function panelRowsOf(ports: InterfaceJson[]): PanelRow[] {
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

/** A row is patched when its port is: the rear port, or the front port on a position row. */
function rowPatched(row: PanelRow): boolean {
	return row.position === null ? row.rear.patched : (row.front?.patched ?? row.rear.patched)
}

/**
 * Patch-panel ports grouped by rear port: `# | Front → peer | Rear (outlet)
 * → peer`, plus `extraColumns` (floor plan). Multi-position rear ports
 * list their positions underneath; unpatched rows are dimmed and show a
 * hint instead of their port names. Unconnected patched ports get a
 * connect button on row hover (`onConnect`), connected ports a
 * disconnect button (`onDisconnect`); `rowActions` (one edit
 * button) edits both ports of a row.
 */
export function PanelPortTable(props: {
	ports: InterfaceJson[]
	links: Map<number, TraceLink>
	endToEnd: (ifaceId: number) => TraceEndToEnd[]
	/** Connects an unconnected port; no button without it. */
	onConnect?: (iface: InterfaceJson) => void
	/** Removes the cable of a connected port; no button without it. */
	onDisconnect?: (link: TraceLink) => void
	rowActions?: (row: PanelRow) => JSX.Element
	extraColumns?: DataTableColumn<PanelRow>[]
}): JSX.Element {
	// Keep row objects (and their DOM nodes) across refreshes, so the browser
	// retains its scroll anchor and the dialog can return focus to its button.
	// Copy the ports: reconciliation must not mutate the query cache's objects.
	const [storedRows, setStoredRows] = createStore<PanelRow[]>([])
	createComputed(() => {
		const next = panelRowsOf(props.ports).map((row) => ({
			...row,
			rear: { ...row.rear },
			front: row.front ? { ...row.front } : null,
		}))
		setStoredRows(reconcile(next, { key: 'key' }))
	})
	const rows = createMemo(() => [...storedRows])

	const portCell = (iface: InterfaceJson | null): JSX.Element => {
		if (!iface) {
			return <span>—</span>
		}
		return (
			<span class="panel-port-cell">
				<span>{iface.name}</span>
				<PortPeer link={props.links.get(iface.id)} endToEnd={props.endToEnd(iface.id)} />
				<CableButtons
					iface={iface}
					link={props.links.get(iface.id)}
					connectable={iface.patched && !iface.connected}
					onConnect={props.onConnect}
					onDisconnect={props.onDisconnect}
				/>
			</span>
		)
	}

	const columns = (): DataTableColumn<PanelRow>[] => [
		{
			key: 'number',
			label: '#',
			getValue: (row: PanelRow): JSX.Element => {
				const label = row.position === null ? String(row.number) : `↳ ${row.position}`
				return rowPatched(row) ? (
					label
				) : (
					<span class="panel-row-unpatched" title={t('device.panel.notPatched')}>
						{label}
					</span>
				)
			},
		},
		{
			key: 'front',
			label: t('device.panel.front'),
			getValue: (row: PanelRow): JSX.Element =>
				!rowPatched(row) ? (
					<span class="panel-port-muted">{t('device.panel.notPatched')}</span>
				) : row.position === null && row.rear.positions > 1 ? (
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
				row.position === null && rowPatched(row) ? portCell(row.rear) : <span />,
		},
		...(props.extraColumns ?? []),
	]

	return (
		<DataTable
			class="panel-port-table"
			columnLines
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
