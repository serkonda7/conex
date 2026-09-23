import { DataTable } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import {
	delete_site_group,
	fetch_site_group,
	fetch_site_groups,
	fetch_sites,
	fetch_tenant,
	type SiteGroupRow,
	type SiteRow,
} from '../api_tenancy'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	InlineError,
	ParentBreadcrumb,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { go } from '../components/list_page'

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

	const { handleDelete } = useDetailDelete({
		noun: 'site group',
		name: () => group()?.name,
		id: props.id,
		remove: delete_site_group,
		setError,
		listRoute: '/site-groups',
	})

	const childCount = (): number => children()?.length ?? 0
	const siteCount = (): number => sites()?.length ?? 0

	return (
		<div>
			<DetailShell
				backTo="/site-groups"
				backLabel="Site Groups"
				loading={group.loading}
				loadingText="Loading site group…"
				record={group()}
				emptyText="Site group not found."
			>
				<ParentBreadcrumb
					parentId={parentId()}
					parentName={parent()?.name}
					parentFallback={`Group ${parentId() ?? ''}`}
					href={`/site-groups/${parentId() ?? ''}`}
					childName={group()?.name}
				/>
				<DetailHeader
					name={group()?.name}
					slug={group()?.slug}
					editHref={`/site-groups/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{group()?.description || 'No description.'}</DetailSubtitle>

				<DetailCard label="Site group details">
					<dt>Slug</dt>
					<dd>
						<code>{group()?.slug}</code>
					</dd>
					<dt>Tenant</dt>
					<dd>
						<ForeignKeyLink
							id={tenantId()}
							loading={tenant.loading}
							name={tenant()?.name}
							href={`/tenants/${tenantId() ?? ''}`}
						/>
					</dd>
					<dt>Parent</dt>
					<dd>
						<ForeignKeyLink
							id={parentId()}
							loading={parent.loading}
							name={parent()?.name}
							href={`/site-groups/${parentId() ?? ''}`}
						/>
					</dd>
					<dt>Description</dt>
					<dd>{group()?.description || '—'}</dd>
					<dt>Comments</dt>
					<dd>{group()?.comments || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="site-group-children"
				title="Child groups"
				count={childCount()}
				loading={children.loading}
				loadingText="Loading child groups…"
				emptyText="No child groups yet."
				hasItems={childCount() > 0}
			>
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
									onClick={(e: MouseEvent): void => go(e, `/site-groups/${g.id}`)}
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
			</RelatedSection>

			<RelatedSection
				id="site-group-sites"
				title="Sites"
				count={siteCount()}
				loading={sites.loading}
				loadingText="Loading sites…"
				emptyText="No sites in this group yet."
				hasItems={siteCount() > 0}
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
			</RelatedSection>

			<InlineError message={error()} />
		</div>
	)
}
