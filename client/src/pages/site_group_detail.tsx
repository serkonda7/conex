import { DataTable } from '@serkonda7/solid-components'
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, Show } from 'solid-js'
import {
	delete_site_group,
	fetch_site_group,
	fetch_site_groups,
	fetch_sites,
	fetch_tenant,
	type SiteGroupRow,
	type SiteRow,
} from '../api_p1'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /site-groups/:id — site group detail: header with slug, parent
 * breadcrumb, detail grid, and the child-groups / sites-in-group tables.
 */
export function SiteGroupDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [group] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_site_group(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const parentId = createMemo(() => group()?.parent_id ?? null)
	const tenantId = createMemo(() => group()?.tenant_id ?? null)
	const [tenant] = createResource(tenantId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_tenant(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [parent] = createResource(parentId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_site_group(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [children] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_site_groups({ parent: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [sites] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_sites({ group: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)

	async function handleDelete(): Promise<void> {
		const g = group()
		if (!g) {
			return
		}
		if (!window.confirm(`Delete site group "${g.name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_site_group(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		navigate('/site-groups', { refresh: true })
	}

	const childCount = (): number => children()?.length ?? 0
	const siteCount = (): number => sites()?.length ?? 0

	return (
		<div>
			<p>
				<a href="/site-groups" onClick={(e: MouseEvent): void => go(e, '/site-groups')}>
					← Site Groups
				</a>
			</p>
			<Show when={!group.loading} fallback={<p class="skeleton">Loading site group…</p>}>
				<Show when={group()} fallback={<p class="empty">Site group not found.</p>}>
					<Show when={parentId() !== null}>
						<p class="page-subtitle">
							<a
								href={`/site-groups/${parentId() ?? ''}`}
								onClick={(e: MouseEvent): void =>
									go(e, `/site-groups/${parentId() ?? ''}`)
								}
							>
								{parent()?.name ?? `Group ${parentId() ?? ''}`}
							</a>{' '}
							/ {group()?.name}
						</p>
					</Show>
					<div class="page-header">
						<h2>
							{group()?.name} <code>{group()?.slug}</code>
						</h2>
						<div class="form-actions">
							<button
								type="button"
								onClick={() => navigate(`/site-groups/${props.id}/edit`)}
							>
								<span aria-hidden="true" class="app-nav-icon">
									<IconPencil size={14} />
								</span>{' '}
								Edit
							</button>
							<button type="button" class="btn-danger" onClick={handleDelete}>
								<span aria-hidden="true" class="app-nav-icon">
									<IconTrash size={14} />
								</span>{' '}
								Delete
							</button>
						</div>
					</div>
					<p class="page-subtitle">{group()?.description || 'No description.'}</p>

					<section class="card" aria-label="Site group details">
						<dl class="detail-grid">
							<dt>Slug</dt>
							<dd>
								<code>{group()?.slug}</code>
							</dd>
							<dt>Tenant</dt>
							<dd>
								<Show when={tenantId() !== null} fallback="—">
									<Show
										when={!tenant.loading}
										fallback={<span class="skeleton">…</span>}
									>
										<Show when={tenant()} fallback={String(tenantId() ?? '—')}>
											<a
												href={`/tenants/${tenantId() ?? ''}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/tenants/${tenantId() ?? ''}`)
												}
											>
												{tenant()?.name}
											</a>
										</Show>
									</Show>
								</Show>
							</dd>
							<dt>Parent</dt>
							<dd>
								<Show when={parentId() !== null} fallback="—">
									<Show
										when={!parent.loading}
										fallback={<span class="skeleton">…</span>}
									>
										<Show when={parent()} fallback={String(parentId() ?? '—')}>
											<a
												href={`/site-groups/${parentId() ?? ''}`}
												onClick={(e: MouseEvent): void =>
													go(e, `/site-groups/${parentId() ?? ''}`)
												}
											>
												{parent()?.name}
											</a>
										</Show>
									</Show>
								</Show>
							</dd>
							<dt>Description</dt>
							<dd>{group()?.description || '—'}</dd>
							<dt>Comments</dt>
							<dd>{group()?.comments || '—'}</dd>
						</dl>
					</section>
				</Show>
			</Show>

			<h3 id="site-group-children">
				Child groups <span class="badge">{childCount()}</span>
			</h3>
			<Show when={!children.loading} fallback={<p class="skeleton">Loading child groups…</p>}>
				<Show when={childCount() > 0} fallback={<p class="empty">No child groups yet.</p>}>
					<DataTable
						rows={() => children() ?? []}
						getRowId={(g: SiteGroupRow): number => g.id}
						showColumnCustomizer
						columns={[
							{
								key: 'name',
								label: 'Name',
								getValue: (g: SiteGroupRow): JSX.Element => (
									<a
										href={`/site-groups/${g.id}`}
										onClick={(e: MouseEvent): void =>
											go(e, `/site-groups/${g.id}`)
										}
									>
										{g.name}
									</a>
								),
							},
							{
								key: 'slug',
								label: 'Slug',
								getValue: (g: SiteGroupRow): JSX.Element => <code>{g.slug}</code>,
							},
						]}
					/>
				</Show>
			</Show>

			<h3 id="site-group-sites">
				Sites <span class="badge">{siteCount()}</span>
			</h3>
			<Show when={!sites.loading} fallback={<p class="skeleton">Loading sites…</p>}>
				<Show
					when={siteCount() > 0}
					fallback={<p class="empty">No sites in this group yet.</p>}
				>
					<DataTable
						rows={() => sites() ?? []}
						getRowId={(s: SiteRow): number => s.id}
						showColumnCustomizer
						columns={[
							{
								key: 'name',
								label: 'Name',
								getValue: (s: SiteRow): JSX.Element => (
									<a
										href={`/sites/${s.id}`}
										onClick={(e: MouseEvent): void => go(e, `/sites/${s.id}`)}
									>
										{s.name}
									</a>
								),
							},
							{
								key: 'slug',
								label: 'Slug',
								getValue: (s: SiteRow): JSX.Element => <code>{s.slug}</code>,
							},
						]}
					/>
				</Show>
			</Show>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
