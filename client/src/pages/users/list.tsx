import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { createResource, createSignal, type JSX } from 'solid-js'
import { fetch_tenants } from '../../api/tenancy'
import { delete_user, fetch_users, type UserJson } from '../../api/users'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { ListRangeStatus, ListSearchField, useDebouncedSearch } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'
import { navigate } from '../../lib/router'

/**
 * /users — account list (`users.manage`): search plus per-row edit/delete.
 * Role/tenant assignment lives on the dedicated add/edit pages. Password
 * hashes never leave the server, so this table shows identity and scope
 * only.
 */
export function UsersPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()

	const [usersPage, { refetch }] = createResource(debouncedSearch, async (q) => {
		const res = await fetch_users({ search: q })
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	// Tenant id → name for the scope column (user managers are global).
	const [tenants] = createRows(fetch_tenants)
	const tenantName = useNameOf(tenants)
	const scopeOf = (id: number | null): string =>
		id === null ? t('common.allTenants') : tenantName(id)

	const columns: DataTableColumn<UserJson>[] = [
		{
			key: 'username',
			label: t('auth.username'),
			getValue: (u: UserJson): JSX.Element => <span>{u.username}</span>,
		},
		{
			key: 'role',
			label: t('user.role'),
			getValue: (u: UserJson): JSX.Element => <span>{u.role_name}</span>,
		},
		{
			key: 'tenant',
			label: t('user.tenantScope'),
			getValue: (u: UserJson): string => scopeOf(u.tenant_id),
		},
	]

	async function handleDelete(user: UserJson): Promise<void> {
		const name = user.username
		if (!window.confirm(t('list.confirmDelete', { noun: tp('noun.user', 1), name }))) {
			return
		}
		setError(null)
		const res = await delete_user(user.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	function rowActions(u: UserJson): JSX.Element {
		return (
			<div class="row-actions">
				<button
					type="button"
					class="icon-btn"
					title={t('user.editNamed', { name: u.username })}
					aria-label={t('user.editUserNamed', { name: u.username })}
					onClick={() => navigate(`/users/${u.id}/edit`)}
				>
					<IconPencil size={16} />
				</button>
				<button
					type="button"
					class="icon-btn"
					title={t('common.deleteNamed', { name: u.username })}
					aria-label={t('user.deleteUserNamed', { name: u.username })}
					onClick={() => void handleDelete(u)}
				>
					<IconTrash size={16} />
				</button>
			</div>
		)
	}

	const emptyText = (): string =>
		debouncedSearch()
			? t('list.noMatch', { noun: tp('noun.user', 2), search: debouncedSearch() })
			: t('user.empty')

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.user', 2)}</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/users/add')}>
					{t('common.add')}
				</button>
			</div>

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.user', 2) })}
					placeholder={t('user.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
			</div>

			<DataTable
				rows={() => usersPage()?.items ?? []}
				getRowId={(u: UserJson): number => u.id}
				columns={columns}
				rowActions={rowActions}
				loading={() => usersPage.loading}
				loadingContent={
					<Loading message={t('list.loading', { noun: tp('noun.user', 2) })} />
				}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<ListRangeStatus total={usersPage()?.total ?? 0} />

			<InlineError message={error()} />
		</div>
	)
}
