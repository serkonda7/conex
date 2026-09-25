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
import { DataTable } from '../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	InlineError,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { t, tp } from '../i18n'
import { goTo } from '../router'
import { siteGroupTrail } from '../trails'

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
	const [trail] = createResource(parentId, siteGroupTrail)
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
		noun: 'noun.siteGroup',
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
				name={group()?.name}
				crumbs={trail()}
				loading={group.loading}
				loadingText={t('siteGroup.loadingOne')}
				record={group()}
				emptyText={t('siteGroup.notFound')}
			>
				<DetailHeader
					name={group()?.name}
					slug={group()?.slug}
					editHref={`/site-groups/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{group()?.description || t('common.noDescription')}</DetailSubtitle>

				<DetailCard label={t('siteGroup.details')}>
					<dt>{t('common.slug')}</dt>
					<dd>
						<code>{group()?.slug}</code>
					</dd>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<ForeignKeyLink
							id={tenantId()}
							loading={tenant.loading}
							name={tenant()?.name}
							href={`/tenants/${tenantId() ?? ''}`}
						/>
					</dd>
					<dt>{t('siteGroup.parent')}</dt>
					<dd>
						<ForeignKeyLink
							id={parentId()}
							loading={parent.loading}
							name={parent()?.name}
							href={`/site-groups/${parentId() ?? ''}`}
						/>
					</dd>
					<dt>{t('common.description')}</dt>
					<dd>{group()?.description || '—'}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{group()?.comments || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="site-group-children"
				title={t('siteGroup.children')}
				count={childCount()}
				loading={children.loading}
				loadingText={t('siteGroup.loadingChildren')}
				emptyText={t('siteGroup.noChildren')}
				hasItems={childCount() > 0}
			>
				<DataTable
					rows={() => children() ?? []}
					getRowId={(g: SiteGroupRow): number => g.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (g: SiteGroupRow): JSX.Element => (
								<a
									href={`/site-groups/${g.id}`}
									onClick={(e: MouseEvent): void =>
										goTo(e, `/site-groups/${g.id}`)
									}
								>
									{g.name}
								</a>
							),
						},
						{
							key: 'slug',
							label: t('common.slug'),
							getValue: (g: SiteGroupRow): JSX.Element => <code>{g.slug}</code>,
						},
					]}
				/>
			</RelatedSection>

			<RelatedSection
				id="site-group-sites"
				title={tp('entity.site', 2)}
				count={siteCount()}
				loading={sites.loading}
				loadingText={t('list.loading', { noun: tp('noun.site', 2) })}
				emptyText={t('siteGroup.noSites')}
				hasItems={siteCount() > 0}
			>
				<DataTable
					rows={() => sites() ?? []}
					getRowId={(s: SiteRow): number => s.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (s: SiteRow): JSX.Element => (
								<a
									href={`/sites/${s.id}`}
									onClick={(e: MouseEvent): void => goTo(e, `/sites/${s.id}`)}
								>
									{s.name}
								</a>
							),
						},
						{
							key: 'slug',
							label: t('common.slug'),
							getValue: (s: SiteRow): JSX.Element => <code>{s.slug}</code>,
						},
					]}
				/>
			</RelatedSection>

			<InlineError message={error()} />
		</div>
	)
}
