import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show } from 'solid-js'
import { fetch_tenants } from '../api_tenancy'
import { delete_user, fetch_users, type UserJson } from '../api_users'
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
		for (const t of tenantsPage()?.items ?? []) {
			map.set(t.id, t.name)
		}
		return (id: number | null): string => {
			if (id === null) {
				return 'Alle Mandanten'
			}
			return map.get(id) ?? `#${id}`
		}
	})

	const rows = createMemo(() => usersPage()?.items ?? [])
	const total = createMemo(() => usersPage()?.total ?? 0)

	const columns: DataTableColumn<UserJson>[] = [
		{
			key: 'username',
			label: 'Benutzername',
			getValue: (u: UserJson): JSX.Element => <span>{u.username}</span>,
		},
		{
			key: 'role',
			label: 'Rolle',
			getValue: (u: UserJson): JSX.Element => (
				<span>
					{{ admin: 'Administrator', editor: 'Redakteur', viewer: 'Betrachter' }[u.role]}
				</span>
			),
		},
		{
			key: 'tenant',
			label: 'Mandantenzuordnung',
			getValue: (u: UserJson): string => tenantName()(u.tenant_id),
		},
	]

	async function handleDelete(id: number, username: string): Promise<void> {
		if (!window.confirm(`Benutzer „${username}“ löschen?`)) {
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
				<h2>Benutzer</h2>
				<button type="button" class="btn-add" onClick={() => navigate('/users/add')}>
					+ Hinzufügen
				</button>
			</div>

			<div class="toolbar-row">
				<label class="toolbar-search">
					<span class="visually-hidden">Benutzer suchen</span>
					<input
						type="search"
						class="toolbar-search-input"
						placeholder="Benutzername suchen…"
						aria-label="Benutzer suchen"
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
							title={`${u.username} bearbeiten`}
							aria-label={`Benutzer ${u.username} bearbeiten`}
							onClick={() => navigate(`/users/${u.id}/edit`)}
						>
							<IconPencil size={16} />
						</button>
						<button
							type="button"
							class="icon-btn"
							title={`${u.username} löschen`}
							aria-label={`Benutzer ${u.username} löschen`}
							onClick={() => void handleDelete(u.id, u.username)}
						>
							<IconTrash size={16} />
						</button>
					</div>
				)}
				loading={() => usersPage.loading}
				loadingContent={<p class="skeleton">Benutzer werden geladen…</p>}
				emptyContent={
					<p class="empty">
						{debouncedSearch()
							? `Keine Benutzer für „${debouncedSearch()}“ gefunden.`
							: 'Noch keine Benutzer vorhanden. Fügen Sie oben den ersten hinzu.'}
					</p>
				}
			/>

			<p class="paginator-showing" role="status">
				Einträge {total() === 0 ? 0 : 1}–{total()} von {total()}
			</p>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
