import { createSignal, type JSX } from 'solid-js'
import {
	delete_tenant_group,
	fetch_tenant_group,
	fetch_tenants,
	type TenantWithCounts,
} from '../../api/tenancy'
import { nameColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { createRecord, createRowsFor } from '../../lib/resource'

/** /tenant-groups/:id — tenant group detail with its member tenants. */
export function TenantGroupDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [group] = createRecord(id, fetch_tenant_group, setError)
	const [tenants] = createRowsFor(id, (key: number) => fetch_tenants({ group: key }), setError)
	const tenantCount = (): number => tenants()?.length ?? 0

	const handleDelete = useDetailDelete({
		noun: 'noun.tenantGroup',
		name: () => group()?.name,
		id: props.id,
		remove: delete_tenant_group,
		setError,
		listRoute: '/tenant-groups',
	})

	return (
		<div>
			<DetailShell
				name={group()?.name}
				record={group}
				loadingText={t('tenantGroup.loadingOne')}
				emptyText={t('tenantGroup.notFound')}
			>
				<DetailHeader
					name={group()?.name}
					slug={group()?.slug}
					editHref={`/tenant-groups/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={group()?.description} />

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
				noun="noun.tenant"
				rows={tenants}
				emptyText={t('tenantGroup.noTenants')}
				viewAllHref={`/tenants?group=${props.id}`}
				customizable
				columns={[
					nameColumn<TenantWithCounts>(t('common.name'), '/tenants'),
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

			<InlineError message={error()} />
		</div>
	)
}
