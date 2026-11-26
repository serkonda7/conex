import { IconLinkPlus, IconUnlink } from '@tabler/icons-solidjs'
import type { PoeType } from 'shared/src/schemas'
import type { TraceEndToEnd, TraceLink } from 'shared/src/types'
import { createComputed, createMemo, type JSX, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { DevicePortJson, InterfaceJson } from '../../api/devices'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { t, tp } from '../../i18n'
import { poeTypeLabel, poeTypeShortLabel } from '../../i18n/labels'
import { ComponentKind, componentGroups } from '../device_types/component_table'
import { COMPONENT_CLASSES, componentClassOf } from '../device_types/components'
import { collapseRuns, RunToggle, useExpandedRuns } from './port_runs'
import { PortPeer } from './trace_peer'

/**
 * Hover buttons of a port cell: connect while `connectable` (with
 * `onConnect`), disconnect while `link` is set (with `onDisconnect`).
 */
export function CableButtons(props: {
	iface: InterfaceJson
	link: TraceLink | undefined
	connectable: boolean
	onConnect?: (iface: InterfaceJson) => void
	onDisconnect?: (link: TraceLink) => void
}): JSX.Element {
	return (
		<>
			<Show when={props.onConnect && props.connectable}>
				<button
					type="button"
					class="icon-btn icon-btn-connect"
					title={t('device.connectToPeer', { name: props.iface.name })}
					aria-label={t('device.connectCableFor', { name: props.iface.name })}
					onClick={(): void => props.onConnect?.(props.iface)}
				>
					<IconLinkPlus size={20} />
				</button>
			</Show>
			<Show when={props.onDisconnect ? props.link : undefined}>
				{(link: () => TraceLink): JSX.Element => (
					<button
						type="button"
						class="icon-btn icon-btn-danger icon-btn-disconnect"
						title={t('device.disconnectPort', { name: props.iface.name })}
						aria-label={t('device.disconnectPort', { name: props.iface.name })}
						onClick={(): void => props.onDisconnect?.(link())}
					>
						<IconUnlink size={20} />
					</button>
				)}
			</Show>
		</>
	)
}

/**
 * Summary row of a run of consecutive disabled, unconnected ports (two or
 * more) of one component class. It carries the class's `kind` and `side`, so
 * it lands in that class's group.
 */
interface PortRunRow {
	/** `run:` and the first port's id; ports use their numeric id. */
	id: string
	kind: string
	side: null
	run: {
		/** Port numbers (interfaces) or names of the first and last port. */
		from: string
		to: string
		/** Ids of the ports in the run. */
		units: string[]
		/** Whether the run's rows show below the summary row. */
		open: boolean
	}
}

type PortTableRow = DevicePortJson | PortRunRow

function isRun(row: PortTableRow): row is PortRunRow {
	return 'run' in row
}

/**
 * Ports of a device (no patch-panel ports) grouped by component class like
 * the device-type components, with kind glyph and cable peer.
 * Interfaces get their 1-based port number (creation order, eth1..ethN);
 * disabled ones carry a pill before it and dim their name and type. Two or
 * more consecutive disabled ports without a cable collapse into one summary
 * row (`5–12`) that expands to their rows. The type adds the PoE type of the
 * port's device-type stub when set. Unconnected enabled ports get a connect
 * button on row hover (`onConnect`), connected ones a disconnect button
 * (`onDisconnect`); `actions` renders the buttons of a row.
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
	const labelOf = (iface: DevicePortJson): string =>
		String(portNumbers().get(iface.id) ?? iface.name)

	// Keep row objects (and their DOM nodes) across refreshes, so the run
	// toggle keeps focus. Copy the ports: reconciliation must not mutate the
	// query cache's objects.
	const [storedRows, setStoredRows] = createStore<PortTableRow[]>([])
	const { expanded, toggle: toggleRun } = useExpandedRuns()
	createComputed(() => {
		const next: PortTableRow[] = []
		for (const { key } of COMPONENT_CLASSES) {
			const ports = props.ports
				.filter((iface) => componentClassOf(iface) === key)
				.map((iface) => ({ ...iface }))
			next.push(
				...collapseRuns(
					ports.map((iface) => [iface]),
					(iface) => String(iface.id),
					([iface]) => !!iface && !iface.enabled && !props.links.has(iface.id),
					expanded(),
					(run, keys, open): PortRunRow => {
						const first = run[0]?.[0]
						const last = run.at(-1)?.[0]
						return {
							id: `run:${keys[0]}`,
							kind: first?.kind ?? '',
							side: null,
							run: {
								from: first ? labelOf(first) : '',
								to: last ? labelOf(last) : '',
								units: keys,
								open,
							},
						}
					},
				),
			)
		}
		setStoredRows(reconcile(next))
	})
	const rows = createMemo(() => [...storedRows])

	const runLabel = (run: PortRunRow['run']): string =>
		t('device.panel.portRange', { from: run.from, to: run.to })

	const columns: DataTableColumn<PortTableRow>[] = [
		{
			key: 'port',
			label: t('device.portNumber'),
			class: 'component-count',
			getValue: (row: PortTableRow): JSX.Element =>
				isRun(row) ? (
					<RunToggle
						open={row.run.open}
						range={runLabel(row.run)}
						label={t(
							row.run.open
								? 'device.collapseDisabledRun'
								: 'device.expandDisabledRun',
							{
								range: runLabel(row.run),
							},
						)}
						onToggle={(): void => toggleRun(row.run)}
					/>
				) : (
					<>
						<Show when={!row.enabled}>
							<span class="badge">{t('device.disabled')}</span>{' '}
						</Show>
						{portNumbers().get(row.id) ?? ''}
					</>
				),
		},
		{
			key: 'name',
			label: t('common.name'),
			class: 'component-name',
			getValue: (row: PortTableRow): JSX.Element =>
				isRun(row) ? (
					<span class="text-muted">{tp('device.disabledRun', row.run.units.length)}</span>
				) : (
					<span classList={{ 'text-muted': !row.enabled }}>{row.name}</span>
				),
		},
		{
			key: 'connection',
			label: t('device.connection'),
			getValue: (row: PortTableRow): JSX.Element => {
				if (isRun(row)) {
					return <span />
				}
				return (
					<Show
						when={props.links.get(row.id) || row.enabled}
						fallback={<span class="text-muted">—</span>}
					>
						<span class="panel-port-cell">
							<PortPeer
								link={props.links.get(row.id)}
								endToEnd={props.endToEnd(row.id)}
							/>
							<CableButtons
								iface={row}
								link={props.links.get(row.id)}
								connectable={!row.connected}
								onConnect={props.onConnect}
								onDisconnect={props.onDisconnect}
							/>
						</span>
					</Show>
				)
			},
		},
		{
			key: 'kind',
			label: t('common.type'),
			getValue: (row: PortTableRow): JSX.Element =>
				isRun(row) ? (
					<span />
				) : (
					<span classList={{ 'component-kind': true, 'text-muted': !row.enabled }}>
						<ComponentKind kind={row.kind} />
						<Show when={row.poe_type}>
							{(poe: () => PoeType): JSX.Element => (
								<span title={poeTypeLabel(poe())}>{poeTypeShortLabel(poe())}</span>
							)}
						</Show>
					</span>
				),
		},
	]
	// Count ports, not rows: a collapsed run stands for its ports, an open
	// one's summary row for none.
	const portCount = (group: PortTableRow[]): number =>
		group.reduce(
			(sum, row) => sum + (isRun(row) ? (row.run.open ? 0 : row.run.units.length) : 1),
			0,
		)
	const actions = props.actions
	return (
		<DataTable
			class="component-table device-port-table"
			columnLines
			rows={rows}
			getRowId={(row: PortTableRow): string => String(row.id)}
			columns={columns}
			showColumnCustomizer
			{...componentGroups<PortTableRow>(portCount)}
			rowActions={
				actions
					? (row: PortTableRow): JSX.Element => (isRun(row) ? <span /> : actions(row))
					: undefined
			}
		/>
	)
}
