import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from 'solid-js'
import { fetch_tenants } from '../api_tenancy'
import { delete_user, fetch_users, type UserJson } from '../api_users'
import { DataTable, type DataTableColumn } from '../components/data_table'
import { ListRangeStatus } from '../components/list_page'
import { t, tp } from '../i18n'
import { roleLabel } from '../i18n/labels'
import { navigate } from '../router'

/**
 * /users — admin-only account list: search plus per-row edit/delete.
 * Role/tenant assignment lives on the dedicated add/edit pages. Password
 * hashes never leave the server, so this table shows identity and scope
 * only.
 */
export function UsersPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [debouncedSearch, setDebouncedSearch] = createSignal('')

	let debounceTimer: number | undefined
	onCleanup(() => {
		window.clearTimeout(debounceTimer)
	})
	createEffect(() => {
		const q = search()
		window.clearTimeout(debounceTimer)
		debounceTimer = window.setTimeout(() => {
			setDebouncedSearch(q.trim())
		}, 250)
	})

	const [usersPage, { refetch }] = createResource(debouncedSearch, async (q) => {
		const res = await fetch_users({ search: q })
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	// Tenant id → name for the scope column (admins see every tenant).
	const [tenantsPage] = createResource(async () => {
		const res = await fetch_tenants({ limit: 200 })
		if (Result.isError(res)) {
			return null
		}
		return res.value
	})
	const tenantName = createMemo(() => {
		const map = new Map<number, string>()
		for (const tenant of tenantsPage()?.items ?? []) {
			map.set(tenant.id, tenant.name)
		}
		return (id: number | null): string => {
			if (id === null) {
				return t('common.allTenants')
			}
			return map.get(id) ?? `#${id}`
		}
	})

	const rows = createMemo(() => usersPage()?.items ?? [])
	const total = createMemo(() => usersPage()?.total ?? 0)

	const columns: DataTableColumn<UserJson>[] = [
		{
			key: 'username',
			label: t('auth.username'),
			getValue: (u: UserJson): JSX.Element => <span>{u.username}</span>,
		},
		{
			key: 'role',
			label: t('user.role'),
			getValue: (u: UserJson): JSX.Element => <span>{roleLabel(u.role)}</span>,
		},
		{
			key: 'tenant',
			label: t('user.tenantScope'),
			getValue: (u: UserJson): string => tenantName()(u.tenant_id),
		},
	]

	async function handleDelete(id: number, username: string): Promise<void> {
		if (
			!window.confirm(t('list.confirmDelete', { noun: tp('noun.user', 1), name: username }))
		) {
			return
		}
		setError(null)
		const res = await delete_user(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.user', 2)}</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/users/add')}>
					{t('common.add')}
				</button>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">
						{t('list.searchLabel', { noun: tp('noun.user', 2) })}
					</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder={t('user.searchPlaceholder')}
						aria-label={t('list.searchLabel', { noun: tp('noun.user', 2) })}
						value={search()}
						onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					/>
				</label>
			</div>

			<DataTable
				rows={rows}
				getRowId={(u: UserJson): number => u.id}
				columns={columns}
				rowActions={(u: UserJson): JSX.Element => (
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
							onClick={() => void handleDelete(u.id, u.username)}
						>
							<IconTrash size={16} />
						</button>
					</div>
				)}
				loading={() => usersPage.loading}
				loadingContent={
					<p class="skeleton">{t('list.loading', { noun: tp('noun.user', 2) })}</p>
				}
				emptyContent={
					<p class="empty">
						{debouncedSearch()
							? t('list.noMatch', {
									noun: tp('noun.user', 2),
									search: debouncedSearch(),
								})
							: t('user.empty')}
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
