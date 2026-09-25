import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../api_devices'
import { fetch_racks, type RackRow } from '../api_racks'
import {
	delete_tenant,
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
	InlineError,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { t, tp } from '../i18n'
import { goTo } from '../router'

/**
 * /tenants/:id — tenant detail: header with slug/description/comments,
 * related-object counts, and the related sites/racks/devices tables.
 * Tenant name links elsewhere navigate here; the edit dialog stays inline
 * so the list page keeps its quick-edit affordance.
 */
export function TenantDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [tenant] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_tenant(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const [sites] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_sites({ tenant: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [siteGroups] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_site_groups({ tenant: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [racks] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_racks({ tenant: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	const [devices] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_devices({ tenant: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)

	const { handleDelete } = useDetailDelete({
		noun: 'noun.tenant',
		name: () => tenant()?.name,
		id: props.id,
		remove: delete_tenant,
		setError,
		listRoute: '/tenants',
	})

	const siteCount = (): number => sites()?.length ?? 0
	const siteGroupCount = (): number => siteGroups()?.length ?? 0
	const rackCount = (): number => racks()?.length ?? 0
	const deviceCount = (): number => devices()?.length ?? 0

	return (
		<div>
			<DetailShell
				backTo="/tenants"
				backLabel={tp('entity.tenant', 2)}
				loading={tenant.loading}
				loadingText={t('tenant.loadingOne')}
				record={tenant()}
				emptyText={t('tenant.notFound')}
			>
				<DetailHeader
					name={tenant()?.name}
					slug={tenant()?.slug}
					editHref={`/tenants/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>
					{tenant()?.description || t('common.noDescription')}
				</DetailSubtitle>

				<div class="detail-stats">
					<a class="detail-stat" href="#tenant-sites">
						<span class="detail-stat-value">{siteCount()}</span>{' '}
						<span class="detail-stat-label">{tp('entity.site', siteCount())}</span>
					</a>
					<a class="detail-stat" href="#tenant-site-groups">
						<span class="detail-stat-value">{siteGroupCount()}</span>{' '}
						<span class="detail-stat-label">
							{tp('entity.siteGroup', siteGroupCount())}
						</span>
					</a>
					<a class="detail-stat" href="#tenant-racks">
						<span class="detail-stat-value">{rackCount()}</span>{' '}
						<span class="detail-stat-label">{tp('entity.rack', rackCount())}</span>
					</a>
					<a class="detail-stat" href="#tenant-devices">
						<span class="detail-stat-value">{deviceCount()}</span>{' '}
						<span class="detail-stat-label">{tp('entity.device', deviceCount())}</span>
					</a>
				</div>

				<DetailCard label={t('tenant.details')}>
					<dt>{t('common.slug')}</dt>
					<dd>
						<code>{tenant()?.slug}</code>
					</dd>
					<dt>{t('common.description')}</dt>
					<dd>{tenant()?.description || '—'}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{tenant()?.comments || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="tenant-sites"
				title={tp('entity.site', 2)}
				count={siteCount()}
				loading={sites.loading}
				loadingText={t('list.loading', { noun: tp('noun.site', 2) })}
				emptyText={t('tenant.noSites')}
				hasItems={siteCount() > 0}
				viewAllHref={`/sites?tenant=${props.id}`}
				viewAllLabel={t('common.viewIn', { target: tp('entity.site', 2) })}
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

			<RelatedSection
				id="tenant-site-groups"
				title={tp('entity.siteGroup', 2)}
				count={siteGroupCount()}
				loading={siteGroups.loading}
				loadingText={t('list.loading', { noun: tp('noun.siteGroup', 2) })}
				emptyText={t('tenant.noSiteGroups')}
				hasItems={siteGroupCount() > 0}
				viewAllHref={`/site-groups?tenant=${props.id}`}
				viewAllLabel={t('common.viewIn', { target: tp('entity.siteGroup', 2) })}
			>
				<DataTable
					rows={() => siteGroups() ?? []}
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
				id="tenant-racks"
				title={tp('entity.rack', 2)}
				count={rackCount()}
				loading={racks.loading}
				loadingText={t('list.loading', { noun: tp('noun.rack', 2) })}
				emptyText={t('tenant.noRacks')}
				hasItems={rackCount() > 0}
			>
				<DataTable
					rows={() => racks() ?? []}
					getRowId={(r: RackRow): number => r.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (r: RackRow): JSX.Element => (
								<a
									href={`/racks/${r.id}`}
									onClick={(e: MouseEvent): void => goTo(e, `/racks/${r.id}`)}
								>
									{r.name}
								</a>
							),
						},
						{
							key: 'height',
							label: t('common.height'),
							getValue: (r: RackRow): string =>
								t('common.heightUnits', { count: r.height_u }),
						},
					]}
				/>
			</RelatedSection>

			<RelatedSection
				id="tenant-devices"
				title={tp('entity.device', 2)}
				count={deviceCount()}
				loading={devices.loading}
				loadingText={t('list.loading', { noun: tp('noun.device', 2) })}
				emptyText={t('tenant.noDevices')}
				hasItems={deviceCount() > 0}
				viewAllHref={`/devices?tenant=${props.id}`}
				viewAllLabel={t('common.viewIn', { target: tp('entity.device', 2) })}
			>
				<DataTable
					rows={() => devices() ?? []}
					getRowId={(d: DeviceRow): number => d.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: t('common.name'),
							getValue: (d: DeviceRow): JSX.Element => (
								<a
									href={`/devices/${d.id}`}
									onClick={(e: MouseEvent): void => goTo(e, `/devices/${d.id}`)}
								>
									{d.name}
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
