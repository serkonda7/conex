import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { createResource, createSignal, type JSX } from 'solid-js'
import { delete_role, fetch_roles, type RoleJson } from '../../api/roles'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { ListRangeStatus, ListSearchField, useDebouncedSearch } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { permissionLabel } from '../../i18n/labels'
import { navigate } from '../../lib/router'

/**
 * /roles — role list (`users.manage`): search plus per-row edit/delete.
 * Permissions are picked on the add/edit pages; roles still assigned to
 * users cannot be deleted (the server answers 409).
 */
export function RolesPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()

	const [rolesPage, { refetch }] = createResource(debouncedSearch, async (q) => {
		const res = await fetch_roles({ search: q })
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const columns: DataTableColumn<RoleJson>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (r: RoleJson): JSX.Element => <span>{r.name}</span>,
		},
		{
			key: 'description',
			label: t('common.description'),
			getValue: (r: RoleJson): string => r.description ?? '',
		},
		{
			key: 'permissions',
			label: t('role.permissions'),
			getValue: (r: RoleJson): string =>
				r.permissions.length === 0
					? t('role.noPermissions')
					: r.permissions.map(permissionLabel).join(', '),
		},
		{
			key: 'users',
			label: tp('entity.user', 2),
			getValue: (r: RoleJson): string => String(r.user_count),
		},
	]

	async function handleDelete(role: RoleJson): Promise<void> {
		const name = role.name
		if (!window.confirm(t('list.confirmDelete', { noun: tp('noun.role', 1), name }))) {
			return
		}
		setError(null)
		const res = await delete_role(role.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	function rowActions(r: RoleJson): JSX.Element {
		return (
			<div class="row-actions">
				<button
					type="button"
					class="icon-btn"
					title={t('common.editNamed', { name: r.name })}
					aria-label={t('role.editRoleNamed', { name: r.name })}
					onClick={() => navigate(`/roles/${r.id}/edit`)}
				>
					<IconPencil size={16} />
				</button>
				<button
					type="button"
					class="icon-btn"
					title={t('common.deleteNamed', { name: r.name })}
					aria-label={t('role.deleteRoleNamed', { name: r.name })}
					onClick={() => void handleDelete(r)}
				>
					<IconTrash size={16} />
				</button>
			</div>
		)
	}

	const emptyText = (): string =>
		debouncedSearch()
			? t('list.noMatch', { noun: tp('noun.role', 2), search: debouncedSearch() })
			: t('role.empty')

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.role', 2)}</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/roles/add')}>
					{t('common.add')}
				</button>
			</div>

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.role', 2) })}
					placeholder={t('role.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
			</div>

			<DataTable
				rows={() => rolesPage()?.items ?? []}
				getRowId={(r: RoleJson): number => r.id}
				columns={columns}
				rowActions={rowActions}
				loading={() => rolesPage.loading}
				loadingContent={
					<Loading message={t('list.loading', { noun: tp('noun.role', 2) })} />
				}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<ListRangeStatus total={rolesPage()?.total ?? 0} />

			<InlineError message={error()} />
		</div>
	)
}
