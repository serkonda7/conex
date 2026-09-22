import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
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
import {
	type DeviceRow,
	fetch_all_interfaces,
	fetch_devices,
	type InterfaceListItem,
} from '../api_p4'
import { navigate, parseId, queryParam } from '../router'
import { use_visible_columns } from '../util/column_visibility'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /interfaces — NetBox-style global interface list across devices: search
 * (interface name, kind, or device name), device filter (deep-linkable via
 * `?device=<id>`), and free/connected filter. Read-only: interfaces are
 * added and renamed on their device's detail page. The whole result set
 * renders at once (API cap: 200).
 */
export function InterfacesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')
	const [deviceFilter, setDeviceFilter] = createSignal(queryParam('device'))
	const [connectedFilter, setConnectedFilter] = createSignal('')

	// Follow device links (`/interfaces?device=<id>`).
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
		device: parseId(deviceFilter()) ?? undefined,
		connected:
			connectedFilter() === ''
				? undefined
				: connectedFilter() === 'connected'
					? true
					: connectedFilter() === 'free'
						? false
						: undefined,
	}))

	const [ifacesPage] = createResource(listSource, async (s) => {
		const res = await fetch_all_interfaces(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => ifacesPage()?.items ?? [])
	const total = createMemo(() => ifacesPage()?.total ?? 0)
	const rangeStart = createMemo(() => (total() === 0 ? 0 : 1))
	const rangeEnd = createMemo(() => total())

	const [devices] = createResource(async () => {
		const res = await fetch_devices()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	const columns: DataTableColumn<InterfaceListItem>[] = [
		{
			key: 'device',
			label: 'Device',
			getValue: (i: InterfaceListItem): JSX.Element => (
				<a
					href={`/devices/${i.device_id}`}
					onClick={(e: MouseEvent): void => go(e, `/devices/${i.device_id}`)}
				>
					{i.device_name}
				</a>
			),
		},
		{
			key: 'name',
			label: 'Interface',
			getValue: (i: InterfaceListItem): JSX.Element => <code>{i.name}</code>,
		},
		{
			key: 'kind',
			label: 'Kind',
			getValue: (i: InterfaceListItem): string => i.kind,
		},
		{
			key: 'status',
			label: 'Status',
			getValue: (i: InterfaceListItem): JSX.Element => (
				<span title={i.connected ? 'connected' : 'free'}>
					<span class={i.connected ? 'status-dot-connected' : 'status-dot-free'}>●</span>
				</span>
			),
		},
		{
			key: 'description',
			label: 'Description',
			getValue: (i: InterfaceListItem): string => i.description ?? '—',
		},
	]

	const interface_column_keys = columns.map((c) => c.key)
	const [visibleColumns, setVisibleColumns] = use_visible_columns(
		'interfaces',
		interface_column_keys,
	)

	const hasFilters = createMemo(
		() => debouncedSearch() !== '' || deviceFilter() !== '' || connectedFilter() !== '',
	)

	return (
		<div>
			<div class="page-header">
				<h2>Interfaces</h2>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">Search interfaces</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder="Search interface, kind, device…"
						aria-label="Search interfaces"
						value={search()}
						onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					/>
				</label>
				<label>
					<span class="visually-hidden">Filter by device</span>
					<select
						aria-label="Filter by device"
						value={deviceFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setDeviceFilter(e.currentTarget.value)
						}
					>
						<option value="">Any device</option>
						<For each={devices() ?? []}>
							{(d: DeviceRow): JSX.Element => <option value={d.id}>{d.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Filter by status</span>
					<select
						aria-label="Filter by status"
						value={connectedFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setConnectedFilter(e.currentTarget.value)
						}
					>
						<option value="">Free or connected</option>
						<option value="free">Free</option>
						<option value="connected">Connected</option>
					</select>
				</label>
			</div>

			<DataTable
				rows={rows}
				getRowId={(i: InterfaceListItem): number => i.id}
				columns={columns}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				loading={() => ifacesPage.loading}
				loadingContent={<p class="skeleton">Loading interfaces…</p>}
				emptyContent={
					<p class="empty">
						{hasFilters()
							? 'No interfaces match the current filters.'
							: 'No interfaces yet. Add a device to expand its ports.'}
					</p>
				}
			/>

			<p class="paginator-showing" role="status">
				Showing {rangeStart()}-{rangeEnd()} of {total()}
			</p>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
