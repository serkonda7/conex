import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import {
	delete_site_group,
	fetch_site_group,
	fetch_sites,
	fetch_tenant,
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

/**
 * /site-groups/:id — flat site group detail: header with slug,
 * detail grid, and the sites-in-group table.
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

	const siteCount = (): number => sites()?.length ?? 0

	return (
		<div>
			<DetailShell
				name={group()?.name}
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
					<dt>{t('common.description')}</dt>
					<dd>{group()?.description || '—'}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{group()?.comments || '—'}</dd>
				</DetailCard>
			</DetailShell>

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
					]}
				/>
			</RelatedSection>

			<InlineError message={error()} />
		</div>
	)
}
