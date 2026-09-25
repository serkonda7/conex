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
} from '../api_devices'
import { DataTable, type DataTableColumn } from '../components/data_table'
import { ListRangeStatus } from '../components/list_page'
import { t, tp } from '../i18n'
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
			label: tp('entity.device', 1),
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
			label: tp('entity.interface', 1),
			getValue: (i: InterfaceListItem): JSX.Element => <code>{i.name}</code>,
		},
		{
			key: 'kind',
			label: t('common.type'),
			getValue: (i: InterfaceListItem): string => i.kind,
		},
		{
			key: 'status',
			label: t('common.status'),
			getValue: (i: InterfaceListItem): JSX.Element => (
				<span title={i.connected ? t('device.connected') : t('device.free')}>
					<span class={i.connected ? 'status-dot-connected' : 'status-dot-free'}>●</span>
				</span>
			),
		},
		{
			key: 'description',
			label: t('common.description'),
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
				<h2>{tp('entity.interface', 2)}</h2>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">
						{t('list.searchLabel', { noun: tp('noun.interface', 2) })}
					</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder={t('interface.searchPlaceholder')}
						aria-label={t('list.searchLabel', { noun: tp('noun.interface', 2) })}
						value={search()}
						onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					/>
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
				<label>
					<span class="visually-hidden">{t('interface.filterByStatus')}</span>
					<select
						aria-label={t('interface.filterByStatus')}
						value={connectedFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setConnectedFilter(e.currentTarget.value)
						}
					>
						<option value="">{t('interface.freeOrConnected')}</option>
						<option value="free">{t('interface.free')}</option>
						<option value="connected">{t('interface.connected')}</option>
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
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.interface', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{hasFilters()
							? t('list.noMatchFilters', { noun: tp('noun.interface', 2) })
							: t('interface.empty')}
					</p>
				}
			/>

			<ListRangeStatus total={total()} />

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
