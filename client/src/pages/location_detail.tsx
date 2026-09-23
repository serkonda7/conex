import { DataTable } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../api_devices'
import { fetch_racks, type RackRow } from '../api_racks'
import {
	delete_location,
	fetch_location,
	fetch_locations,
	fetch_site,
	fetch_tenant,
	type LocationRow,
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
 * /locations/:id — location detail: header with slug, parent breadcrumb,
 * detail grid, and the child-locations / racks / devices tables.
 */
export function LocationDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [location] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_location(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const siteId = createMemo(() => location()?.site_id ?? null)
	const [site] = createResource(siteId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_site(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const parentId = createMemo(() => location()?.parent_id ?? null)
	const [parent] = createResource(parentId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_location(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const tenantId = createMemo(() => location()?.tenant_id ?? null)
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
	const [children] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_locations({ parent: id })
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
			const res = await fetch_racks({ location: id })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)
	// Devices have no location filter on the API, so scope by site and
	// narrow to this location client-side.
	const [devices] = createResource(
		() => ({ site: siteId(), location: props.id }),
		async ({ site: siteKey, location: locationKey }) => {
			if (!siteKey) {
				return []
			}
			const res = await fetch_devices({ site: siteKey })
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items.filter((d) => d.location_id === locationKey)
		},
	)

	const { handleDelete } = useDetailDelete({
		noun: 'location',
		name: () => location()?.name,
		id: props.id,
		remove: delete_location,
		setError,
		listRoute: '/locations',
	})

	const childCount = (): number => children()?.length ?? 0
	const rackCount = (): number => racks()?.length ?? 0
	const deviceCount = (): number => devices()?.length ?? 0

	return (
		<div>
			<DetailShell
				backTo="/locations"
				backLabel="Locations"
				loading={location.loading}
				loadingText="Loading location…"
				record={location()}
				emptyText="Location not found."
			>
				<ParentBreadcrumb
					parentId={parentId()}
					parentName={parent()?.name}
					parentFallback={`Location ${parentId() ?? ''}`}
					href={`/locations/${parentId() ?? ''}`}
					childName={location()?.name}
				/>
				<DetailHeader
					name={location()?.name}
					slug={location()?.slug}
					editHref={`/locations/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{location()?.description || 'No description.'}</DetailSubtitle>

				<DetailCard label="Location details">
					<dt>Slug</dt>
					<dd>
						<code>{location()?.slug}</code>
					</dd>
					<dt>Site</dt>
					<dd>
						<ForeignKeyLink
							id={siteId()}
							loading={site.loading}
							name={site()?.name}
							href={`/sites/${siteId() ?? ''}`}
						/>
					</dd>
					<dt>Parent</dt>
					<dd>
						<ForeignKeyLink
							id={parentId()}
							loading={parent.loading}
							name={parent()?.name}
							href={`/locations/${parentId() ?? ''}`}
						/>
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
					<dt>Description</dt>
					<dd>{location()?.description || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="location-children"
				title="Child locations"
				count={childCount()}
				loading={children.loading}
				loadingText="Loading child locations…"
				emptyText="No child locations yet."
				hasItems={childCount() > 0}
			>
				<DataTable
					rows={() => children() ?? []}
					getRowId={(l: LocationRow): number => l.id}
					showColumnCustomizer
					columns={[
						{
							key: 'name',
							label: 'Name',
							getValue: (l: LocationRow): JSX.Element => (
								<a
									href={`/locations/${l.id}`}
									onClick={(e: MouseEvent): void => go(e, `/locations/${l.id}`)}
								>
									{l.name}
								</a>
							),
						},
						{
							key: 'slug',
							label: 'Slug',
							getValue: (l: LocationRow): JSX.Element => <code>{l.slug}</code>,
						},
					]}
				/>
			</RelatedSection>

			<RelatedSection
				id="location-racks"
				title="Racks"
				count={rackCount()}
				loading={racks.loading}
				loadingText="Loading racks…"
				emptyText="No racks here yet."
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
							getValue: (r: RackRow): string => `${r.height_u}U`,
						},
					]}
				/>
			</RelatedSection>

			<RelatedSection
				id="location-devices"
				title="Devices"
				count={deviceCount()}
				loading={devices.loading}
				loadingText="Loading devices…"
				emptyText="No devices here yet."
				hasItems={deviceCount() > 0}
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
