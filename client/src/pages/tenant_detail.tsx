import { DataTable } from '@serkonda7/solid-components'
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
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	InlineError,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { go } from '../components/list_page'

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
		noun: 'tenant',
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
				backLabel="Mandanten"
				loading={tenant.loading}
				loadingText="Mandant wird geladen…"
				record={tenant()}
				emptyText="Tenant not found."
			>
				<DetailHeader
					name={tenant()?.name}
					slug={tenant()?.slug}
					editHref={`/tenants/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{tenant()?.description || 'No description.'}</DetailSubtitle>

				<div class="detail-stats">
					<a class="detail-stat" href="#tenant-sites">
						<span class="detail-stat-value">{siteCount()}</span>{' '}
						<span class="detail-stat-label">Site{siteCount() === 1 ? '' : 's'}</span>
					</a>
					<a class="detail-stat" href="#tenant-site-groups">
						<span class="detail-stat-value">{siteGroupCount()}</span>{' '}
						<span class="detail-stat-label">
							Site group{siteGroupCount() === 1 ? '' : 's'}
						</span>
					</a>
					<a class="detail-stat" href="#tenant-racks">
						<span class="detail-stat-value">{rackCount()}</span>{' '}
						<span class="detail-stat-label">Rack{rackCount() === 1 ? '' : 's'}</span>
					</a>
					<a class="detail-stat" href="#tenant-devices">
						<span class="detail-stat-value">{deviceCount()}</span>{' '}
						<span class="detail-stat-label">
							Device{deviceCount() === 1 ? '' : 's'}
						</span>
					</a>
				</div>

				<DetailCard label="Mandantendetails">
					<dt>Kurzname</dt>
					<dd>
						<code>{tenant()?.slug}</code>
					</dd>
					<dt>Beschreibung</dt>
					<dd>{tenant()?.description || '—'}</dd>
					<dt>Kommentare</dt>
					<dd>{tenant()?.comments || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="tenant-sites"
				title="Sites"
				count={siteCount()}
				loading={sites.loading}
				loadingText="Standorte werden geladen…"
				emptyText="Für diesen Mandanten sind noch keine Standorte vorhanden."
				hasItems={siteCount() > 0}
				viewAllHref={`/sites?tenant=${props.id}`}
				viewAllLabel="View in Sites →"
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

			<RelatedSection
				id="tenant-site-groups"
				title="Site groups"
				count={siteGroupCount()}
				loading={siteGroups.loading}
				loadingText="Standortgruppen werden geladen…"
				emptyText="Für diesen Mandanten sind noch keine Standortgruppen vorhanden."
				hasItems={siteGroupCount() > 0}
				viewAllHref={`/site-groups?tenant=${props.id}`}
				viewAllLabel="View in Site Groups →"
			>
				<DataTable
					rows={() => siteGroups() ?? []}
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
				id="tenant-racks"
				title="Racks"
				count={rackCount()}
				loading={racks.loading}
				loadingText="Racks werden geladen…"
				emptyText="Für diesen Mandanten sind noch keine Racks vorhanden."
				hasItems={rackCount() > 0}
			>
				<DataTable
					rows={() => racks() ?? []}
					getRowId={(r: RackRow): number => r.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: 'Name',
							getValue: (r: RackRow): JSX.Element => (
								<a
									href={`/racks/${r.id}`}
									onClick={(e: MouseEvent): void => go(e, `/racks/${r.id}`)}
								>
									{r.name}
								</a>
							),
						},
						{
							key: 'height',
							label: 'Height',
							getValue: (r: RackRow): string => `${r.height_u} HE`,
						},
					]}
				/>
			</RelatedSection>

			<RelatedSection
				id="tenant-devices"
				title="Devices"
				count={deviceCount()}
				loading={devices.loading}
				loadingText="Geräte werden geladen…"
				emptyText="Für diesen Mandanten sind noch keine Geräte vorhanden."
				hasItems={deviceCount() > 0}
				viewAllHref={`/devices?tenant=${props.id}`}
				viewAllLabel="View in Devices →"
			>
				<DataTable
					rows={() => devices() ?? []}
					getRowId={(d: DeviceRow): number => d.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: 'Name',
							getValue: (d: DeviceRow): JSX.Element => (
								<a
									href={`/devices/${d.id}`}
									onClick={(e: MouseEvent): void => go(e, `/devices/${d.id}`)}
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
