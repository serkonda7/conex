import { Result } from 'better-result'
import type { CableStatus, ImportRowResult, InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from 'solid-js'
import { type CableRow, create_cable, delete_cable, fetch_cables } from '../api_cables'
import {
	type DeviceRow,
	fetch_all_interfaces,
	fetch_devices,
	fetch_interfaces,
	type InterfaceJson,
} from '../api_devices'
import { download_csv, upload_csv } from '../api_transfer'
import { DataTable, type DataTableColumn } from '../components/data_table'
import { ListRangeStatus } from '../components/list_page'
import { t, tp } from '../i18n'
import { cableStatusLabel } from '../i18n/labels'
import { goTo, navigate, parseId, queryParam } from '../router'
import { use_visible_columns } from '../util/column_visibility'

const CABLE_CSV_COLUMNS = 'a_device,a_interface,b_device,b_interface,label,kind,status'

const CABLE_STATUSES: CableStatus[] = ['connected', 'planned', 'decommissioned']

/**
 * /connections — global cable list (NetBox-style cable connections):
 * search (label/kind), status filter, device filter (either end,
 * deep-linkable via `?device=<id>`), row selection with bulk disconnect,
 * a connect form joining two free ports, and CSV export/import.
 * The whole result set renders at once (API cap: 200).
 */
export function ConnectionsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')
	const [statusFilter, setStatusFilter] = createSignal('')
	const [deviceFilter, setDeviceFilter] = createSignal(queryParam('device'))
	const [selected, setSelected] = createSignal<number[]>([])

	// Connect form state: two ends (device + free port) plus cable fields.
	const [aDevice, setADevice] = createSignal('')
	const [aIface, setAIface] = createSignal('')
	const [bDevice, setBDevice] = createSignal('')
	const [bIface, setBIface] = createSignal('')
	const [cableLabel, setCableLabel] = createSignal('')
	const [cableKind, setCableKind] = createSignal('')
	const [cableStatus, setCableStatus] = createSignal('connected')

	// CSV import state.
	const [importing, setImporting] = createSignal(false)
	const [importSummary, setImportSummary] = createSignal<string | null>(null)
	const [importRows, setImportRows] = createSignal<ImportRowResult[] | null>(null)

	// Follow device links (`/connections?device=<id>`).
	createEffect(() => {
		setDeviceFilter(queryParam('device'))
	})

	let debounceTimer: number | undefined
	createEffect(() => {
		const q = search()
		window.clearTimeout(debounceTimer)
		debounceTimer = window.setTimeout(() => {
			setDebouncedSearch(q.trim())
		}, 250)
	})
	onCleanup(() => {
		window.clearTimeout(debounceTimer)
	})

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		status:
			statusFilter() === ''
				? undefined
				: (statusFilter() as 'connected' | 'planned' | 'decommissioned'),
		device: parseId(deviceFilter()) ?? undefined,
	}))

	const [cablesPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_cables(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => cablesPage()?.items ?? [])
	const total = createMemo(() => cablesPage()?.total ?? 0)

	// A new result set invalidates the checkbox selection.
	createEffect(() => {
		listSource()
		setSelected([])
	})

	const [devices] = createResource(async () => {
		const res = await fetch_devices()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	// Endpoint names: one global interface list maps every cable end id to
	// `device:port`. Falls back to the raw id when a row is missing.
	const [allIfaces] = createResource(async () => {
		const res = await fetch_all_interfaces()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	const ifaceById = createMemo(() => {
		const map = new Map<number, { device_id: number; device_name: string; name: string }>()
		for (const i of allIfaces() ?? []) {
			map.set(i.id, { device_id: i.device_id, device_name: i.device_name, name: i.name })
		}
		return map
	})

	function endpointLabel(id: number): { deviceId: number | null; text: string } {
		const hit = ifaceById().get(id)
		if (hit) {
			return { deviceId: hit.device_id, text: `${hit.device_name}:${hit.name}` }
		}
		return { deviceId: null, text: `#${id}` }
	}

	// Free-port pickers for the connect form, loaded per selected device.
	const [aIfaces] = createResource(aDevice, async (raw: string) => {
		const id = parseId(raw)
		if (id === null) {
			return []
		}
		const res = await fetch_interfaces(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value
	})
	const [bIfaces] = createResource(bDevice, async (raw: string) => {
		const id = parseId(raw)
		if (id === null) {
			return []
		}
		const res = await fetch_interfaces(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value
	})

	const freeA = createMemo(() => (aIfaces() ?? []).filter((i) => !i.connected))
	const freeB = createMemo(() => (bIfaces() ?? []).filter((i) => !i.connected))

	const columns: DataTableColumn<CableRow>[] = [
		{
			key: 'a',
			label: t('connection.endpointA'),
			getValue: (c: CableRow): JSX.Element => {
				const end = endpointLabel(c.a_interface_id)
				return end.deviceId === null ? (
					<code>{end.text}</code>
				) : (
					<a
						href={`/devices/${end.deviceId}`}
						onClick={(e: MouseEvent): void => goTo(e, `/devices/${end.deviceId ?? ''}`)}
					>
						<code>{end.text}</code>
					</a>
				)
			},
		},
		{
			key: 'b',
			label: t('connection.endpointB'),
			getValue: (c: CableRow): JSX.Element => {
				const end = endpointLabel(c.b_interface_id)
				return end.deviceId === null ? (
					<code>{end.text}</code>
				) : (
					<a
						href={`/devices/${end.deviceId}`}
						onClick={(e: MouseEvent): void => goTo(e, `/devices/${end.deviceId ?? ''}`)}
					>
						<code>{end.text}</code>
					</a>
				)
			},
		},
		{
			key: 'label',
			label: t('connection.label'),
			getValue: (c: CableRow): string => c.label ?? '—',
		},
		{
			key: 'status',
			label: t('common.status'),
			getValue: (c: CableRow): JSX.Element => (
				<span class={`badge badge-${c.status}`}>{cableStatusLabel(c.status)}</span>
			),
		},
		{
			key: 'kind',
			label: t('common.type'),
			getValue: (c: CableRow): string => c.kind ?? '—',
		},
	]

	const connection_column_keys = columns.map((c) => c.key)
	const [visibleColumns, setVisibleColumns] = use_visible_columns(
		'connections',
		connection_column_keys,
	)

	const hasFilters = createMemo(
		() => debouncedSearch() !== '' || statusFilter() !== '' || deviceFilter() !== '',
	)

	function resetConnectForm(): void {
		setADevice('')
		setAIface('')
		setBDevice('')
		setBIface('')
		setCableLabel('')
		setCableKind('')
		setCableStatus('connected')
	}

	async function handleConnect(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		if (!aIface() || !bIface()) {
			setError(t('connection.pickBothPorts'))
			return
		}
		const res = await create_cable({
			a_interface_id: Number(aIface()),
			b_interface_id: Number(bIface()),
			label: cableLabel().trim() === '' ? undefined : cableLabel().trim(),
			kind: cableKind().trim() === '' ? undefined : cableKind().trim(),
			status: cableStatus() as CableStatus,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		resetConnectForm()
		void refetch()
	}

	async function handleDisconnect(id: number): Promise<void> {
		setError(null)
		const res = await delete_cable(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setSelected((prev) => prev.filter((s) => s !== id))
		void refetch()
	}

	async function handleBulkDisconnect(): Promise<void> {
		const ids = selected()
		if (ids.length === 0) {
			return
		}
		if (!window.confirm(tp('connection.confirmBulkDisconnect', ids.length))) {
			return
		}
		setError(null)
		const failures: string[] = []
		for (const id of ids) {
			const res = await delete_cable(id)
			if (Result.isError(res)) {
				failures.push(res.error.message)
			}
		}
		setSelected([])
		if (failures.length > 0) {
			setError(failures[0] ?? t('connection.bulkDisconnectFailed'))
		}
		void refetch()
	}

	async function handleExport(): Promise<void> {
		setError(null)
		const res = await download_csv('cables')
		if (Result.isError(res)) {
			setError(res.error.message)
		}
	}

	async function handleImportFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
		const file = e.currentTarget.files?.[0]
		e.currentTarget.value = ''
		if (!file) {
			return
		}
		setError(null)
		setImportSummary(null)
		setImportRows(null)
		setImporting(true)
		let text = ''
		try {
			text = await file.text()
		} catch {
			setImporting(false)
			setError(t('connection.fileReadFailed'))
			return
		}
		const res = await upload_csv('cables', text)
		setImporting(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setImportSummary(
			t('connection.importSummary', {
				created: res.value.created,
				failed: res.value.failed,
			}),
		)
		setImportRows(res.value.rows)
		void refetch()
	}

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.connection', 2)}</h2>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">
						{t('list.searchLabel', { noun: tp('noun.connection', 2) })}
					</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder={t('connection.searchPlaceholder')}
						aria-label={t('list.searchLabel', { noun: tp('noun.connection', 2) })}
						value={search()}
						onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					/>
				</label>
				<label>
					<span class="visually-hidden">{t('interface.filterByStatus')}</span>
					<select
						aria-label={t('interface.filterByStatus')}
						value={statusFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setStatusFilter(e.currentTarget.value)
						}
					>
						<option value="">{t('connection.anyStatus')}</option>
						<For each={CABLE_STATUSES}>
							{(status: CableStatus): JSX.Element => (
								<option value={status}>{cableStatusLabel(status)}</option>
							)}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">{t('interface.filterByDevice')}</span>
					<select
						aria-label={t('interface.filterByDevice')}
						value={deviceFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setDeviceFilter(e.currentTarget.value)
						}
					>
						<option value="">{t('interface.allDevices')}</option>
						<For each={devices() ?? []}>
							{(d: DeviceRow): JSX.Element => <option value={d.id}>{d.name}</option>}
						</For>
					</select>
				</label>
				<span class="toolbar-spacer" />
				<button type="button" onClick={handleExport}>
					{t('connection.exportCsv')}
				</button>
				<label>
					<span class="visually-hidden">{t('connection.importCsv')}</span>
					<input
						type="file"
						accept=".csv,text/csv"
						aria-label={t('connection.importCsv')}
						disabled={importing()}
						onChange={handleImportFile}
					/>
				</label>
				<Show when={selected().length > 0}>
					<button type="button" class="btn-danger" onClick={handleBulkDisconnect}>
						{t('connection.disconnectSelected', { count: selected().length })}
					</button>
				</Show>
			</div>
			<p class="field-hint">{t('connection.csvColumns', { columns: CABLE_CSV_COLUMNS })}</p>

			<section class="card" aria-label={t('connection.connectTwoPorts')}>
				<h3>{t('connection.connectTwoPorts')}</h3>
				<form onSubmit={handleConnect}>
					<select
						value={aDevice()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) => {
							setADevice(e.currentTarget.value)
							setAIface('')
						}}
						aria-label={t('connection.deviceA')}
					>
						<option value="">{t('connection.deviceAPlaceholder')}</option>
						<For each={devices() ?? []}>
							{(d: DeviceRow): JSX.Element => <option value={d.id}>{d.name}</option>}
						</For>
					</select>{' '}
					<select
						value={aIface()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setAIface(e.currentTarget.value)
						}
						aria-label={t('connection.freePortA')}
					>
						<option value="">{t('connection.freePortAPlaceholder')}</option>
						<For each={freeA()}>
							{(i: InterfaceJson): JSX.Element => (
								<option value={i.id}>{i.name}</option>
							)}
						</For>
					</select>{' '}
					<select
						value={bDevice()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) => {
							setBDevice(e.currentTarget.value)
							setBIface('')
						}}
						aria-label={t('connection.deviceB')}
					>
						<option value="">{t('connection.deviceBPlaceholder')}</option>
						<For each={devices() ?? []}>
							{(d: DeviceRow): JSX.Element => <option value={d.id}>{d.name}</option>}
						</For>
					</select>{' '}
					<select
						value={bIface()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setBIface(e.currentTarget.value)
						}
						aria-label={t('connection.freePortB')}
					>
						<option value="">{t('connection.freePortBPlaceholder')}</option>
						<For each={freeB()}>
							{(i: InterfaceJson): JSX.Element => (
								<option value={i.id}>{i.name}</option>
							)}
						</For>
					</select>{' '}
					<input
						placeholder={t('connection.labelPlaceholder')}
						aria-label={t('connection.cableLabel')}
						value={cableLabel()}
						onInput={(e: InputEventAndTarget) => setCableLabel(e.currentTarget.value)}
					/>{' '}
					<input
						placeholder={t('connection.typePlaceholder')}
						aria-label={t('connection.cableType')}
						value={cableKind()}
						onInput={(e: InputEventAndTarget) => setCableKind(e.currentTarget.value)}
					/>{' '}
					<select
						value={cableStatus()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setCableStatus(e.currentTarget.value)
						}
						aria-label={t('connection.cableStatus')}
					>
						<For each={CABLE_STATUSES}>
							{(status: CableStatus): JSX.Element => (
								<option value={status}>{cableStatusLabel(status)}</option>
							)}
						</For>
					</select>{' '}
					<button type="submit">{t('device.connect')}</button>
				</form>
			</section>

			<DataTable
				rows={rows}
				getRowId={(c: CableRow): number => c.id}
				columns={columns}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				selected={selected}
				onSelectionChange={(ids: (string | number)[]): void => {
					setSelected(ids.map((id) => Number(id)))
				}}
				selectionLabel={t('list.selectAll', { noun: tp('noun.connection', 2) })}
				rowActions={(c: CableRow): JSX.Element => (
					<span class="row-actions">
						<button type="button" onClick={() => navigate(`/topology?cable=${c.id}`)}>
							{t('connection.show')}
						</button>
						<button
							type="button"
							class="btn-danger"
							onClick={() => handleDisconnect(c.id)}
						>
							{t('device.disconnect')}
						</button>
					</span>
				)}
				loading={() => cablesPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.connection', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{hasFilters()
							? t('list.noMatchFilters', { noun: tp('noun.connection', 2) })
							: t('connection.empty')}
					</p>
				}
			/>

			<ListRangeStatus total={total()} />

			<Show when={importSummary() !== null}>
				<p class="page-subtitle" role="status">
					{t('connection.importResult', { summary: importSummary() ?? '' })}
				</p>
			</Show>
			<Show when={(importRows() ?? []).length > 0}>
				<DataTable
					rows={() => importRows() ?? []}
					getRowId={(r: ImportRowResult): number => r.row}
					showColumnCustomizer
					columns={[
						{
							key: 'row',
							label: t('import.row'),
							getValue: (r: ImportRowResult): number => r.row,
						},
						{
							key: 'status',
							label: t('common.status'),
							getValue: (r: ImportRowResult): JSX.Element => (
								<span class={`badge badge-${r.ok ? 'active' : 'decommissioned'}`}>
									{r.ok ? t('import.created') : t('import.failed')}
								</span>
							),
						},
						{
							key: 'id',
							label: t('import.id'),
							getValue: (r: ImportRowResult): string =>
								r.id === null ? '—' : String(r.id),
						},
						{
							key: 'error',
							label: t('import.error'),
							getValue: (r: ImportRowResult): string => r.error ?? '—',
						},
					]}
					empty={false}
				/>
			</Show>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
