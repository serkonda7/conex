import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import {
	delete_tenant_group,
	fetch_tenant_group,
	fetch_tenants,
	type TenantWithCounts,
} from '../api_tenancy'
import { DataTable } from '../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	InlineError,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { t, tp } from '../i18n'
import { goTo } from '../router'

/** /tenant-groups/:id — tenant group detail with its member tenants. */
export function TenantGroupDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [group] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_tenant_group(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const [tenants] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_tenants({ group: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)

	const { handleDelete } = useDetailDelete({
		noun: 'noun.tenantGroup',
		name: () => group()?.name,
		id: props.id,
		remove: delete_tenant_group,
		setError,
		listRoute: '/tenant-groups',
	})

	const tenantCount = (): number => tenants()?.length ?? 0

	return (
		<div>
			<DetailShell
				name={group()?.name}
				loading={group.loading}
				loadingText={t('tenantGroup.loadingOne')}
				record={group()}
				emptyText={t('tenantGroup.notFound')}
			>
				<DetailHeader
					name={group()?.name}
					slug={group()?.slug}
					editHref={`/tenant-groups/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{group()?.description || t('common.noDescription')}</DetailSubtitle>

				<div class="detail-stats">
					<a class="detail-stat" href="#tenant-group-tenants">
						<span class="detail-stat-value">{tenantCount()}</span>{' '}
						<span class="detail-stat-label">{tp('entity.tenant', tenantCount())}</span>
					</a>
				</div>

				<DetailCard label={t('tenantGroup.details')}>
					<dt>{t('common.slug')}</dt>
					<dd>
						<code>{group()?.slug}</code>
					</dd>
					<dt>{t('common.description')}</dt>
					<dd>{group()?.description || '—'}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{group()?.comments || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="tenant-group-tenants"
				title={tp('entity.tenant', 2)}
				count={tenantCount()}
				loading={tenants.loading}
				loadingText={t('list.loading', { noun: tp('noun.tenant', 2) })}
				emptyText={t('tenantGroup.noTenants')}
				hasItems={tenantCount() > 0}
				viewAllHref={`/tenants?group=${props.id}`}
				viewAllLabel={t('common.viewIn', { target: tp('entity.tenant', 2) })}
			>
				<DataTable
					rows={() => tenants() ?? []}
					getRowId={(row: TenantWithCounts): number => row.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (row: TenantWithCounts): JSX.Element => (
								<a
									href={`/tenants/${row.id}`}
									onClick={(e: MouseEvent): void => goTo(e, `/tenants/${row.id}`)}
								>
									{row.name}
								</a>
							),
						},
						{
							key: 'sites',
							label: tp('entity.site', 2),
							getValue: (row: TenantWithCounts): number => row.site_count,
						},
						{
							key: 'racks',
							label: tp('entity.rack', 2),
							getValue: (row: TenantWithCounts): number => row.rack_count,
						},
						{
							key: 'devices',
							label: tp('entity.device', 2),
							getValue: (row: TenantWithCounts): number => row.device_count,
						},
					]}
				/>
			</RelatedSection>

			<InlineError message={error()} />
		</div>
	)
}
