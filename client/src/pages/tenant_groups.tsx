import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import {
	delete_tenant_group,
	fetch_tenant_groups,
	type TenantGroupListItem,
	type TenantGroupSort,
} from '../api_tenancy'
import { DataTable, type DataTableColumn } from '../components/data_table'
import {
	BulkDeleteButton,
	ListError,
	ListPageHeader,
	ListRangeStatus,
	ListRowActions,
	ListSearchField,
	RowMenu,
	type RowMenuAnchor,
	useDebouncedSearch,
	useListDelete,
	useListSelection,
	useRowMenu,
	useSort,
	useTableColumns,
} from '../components/list_page'
import { t, tp } from '../i18n'
import { goTo } from '../router'
import { canWrite } from '../session'

/**
 * /tenant-groups — flat tenant group list: search, sortable columns,
 * member counts, row selection with bulk delete. The whole result set
 * renders at once (API cap: 200).
 */
export function TenantGroupsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const { sort, order, handleSort, clearSort } = useSort<TenantGroupSort>('name')

	const listSource = createMemo(() => ({
		search: debouncedSearch(),
		sort: sort() ?? 'name',
		order: order(),
	}))

	const { selected, setSelected, selection } = useListSelection(listSource, 'noun.tenantGroup')
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const [groupsPage, { refetch }] = createResource(listSource, async (s) => {
		const res = await fetch_tenant_groups(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const rows = createMemo(() => groupsPage()?.items ?? [])
	const total = createMemo(() => groupsPage()?.total ?? 0)

	const columns: DataTableColumn<TenantGroupListItem>[] = [
		{
			key: 'name',
			label: tp('entity.tenantGroup', 1),
			sortable: true,
			getValue: (row: TenantGroupListItem): JSX.Element => (
				<a
					href={`/tenant-groups/${row.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/tenant-groups/${row.id}`)}
				>
					{row.name}
				</a>
			),
		},
		{
			key: 'description',
			label: t('common.description'),
			sortable: true,
			class: 'cell-truncate',
			getValue: (row: TenantGroupListItem): JSX.Element => (
				<span title={row.description ?? ''}>{row.description || '—'}</span>
			),
		},
		{
			key: 'tenants',
			label: tp('entity.tenant', 2),
			getValue: (row: TenantGroupListItem): JSX.Element => (
				<a
					href={`/tenants?group=${row.id}`}
					onClick={(e: MouseEvent): void => goTo(e, `/tenants?group=${row.id}`)}
				>
					{row.tenant_count}
				</a>
			),
		},
	]

	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'tenant-groups',
		columns.map((c) => c.key),
	)

	const { handleDelete, handleBulkDelete } = useListDelete({
		noun: 'noun.tenantGroup',
		remove: delete_tenant_group,
		setError,
		refetch,
		selected,
		setSelected,
	})

	return (
		<div>
			<ListPageHeader title={tp('entity.tenantGroup', 2)} add_href="/tenant-groups/add" />

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.tenantGroup', 2) })}
					placeholder={t('tenantGroup.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<span class="toolbar-spacer" />
				<BulkDeleteButton count={selected().length} onClick={handleBulkDelete} />
			</div>

			<DataTable
				rows={rows}
				getRowId={(row: TenantGroupListItem): number => row.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				showColumnCustomizer
				visibleColumns={visibleColumns}
				onVisibleColumnsChange={setVisibleColumns}
				{...selection}
				rowActions={
					canWrite()
						? (row: TenantGroupListItem): JSX.Element => (
								<ListRowActions
									edit_href={`/tenant-groups/${row.id}/edit`}
									name={row.name}
									menu_open={openMenu()?.id === row.id}
									onToggleMenu={(
										e: MouseEvent & { currentTarget: HTMLButtonElement },
									): void => toggleMenu(e, row.id, row.name)}
									onCloseMenu={closeMenu}
								/>
							)
						: undefined
				}
				loading={() => groupsPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.tenantGroup', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch()
							? t('list.noMatch', {
									noun: tp('noun.tenantGroup', 2),
									search: debouncedSearch(),
								})
							: t('tenantGroup.empty')}
					</p>
				}
			/>

			<ListRangeStatus total={total()} />

			<RowMenu
				menu={openMenu}
				onClose={closeMenu}
				onDelete={(menu: RowMenuAnchor): void => {
					void handleDelete(menu.id, menu.name)
				}}
			/>

			<ListError message={error()} />
		</div>
	)
}
