import { createResource, createSignal, type JSX } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../../api/devices'
import { fetch_racks, type RackRow } from '../../api/racks'
import {
	delete_location,
	fetch_location,
	fetch_locations,
	fetch_site,
	fetch_tenant,
	type LocationRow,
} from '../../api/tenancy'
import { nameColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RecordLink,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { locationTypeLabel } from '../../i18n/labels'
import { locationTypeIcon } from '../../lib/icons'
import { createRecord, createRowsFor } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { siteTrail } from '../../lib/trails'
import { rackHeightColumn } from '../racks/columns'

/**
 * /locations/:id — location detail: header with slug, parent breadcrumb,
 * detail grid, and the child-locations / racks / devices tables.
 */
export function LocationDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [location] = createRecord(id, fetch_location, setError)
	const siteId = (): number | undefined => location()?.site_id
	const parentId = (): number | null | undefined => location()?.parent_id
	const tenantId = (): number | null | undefined => location()?.tenant_id
	const [site] = createRecord(siteId, fetch_site, setError)
	const [parent] = createRecord(parentId, fetch_location, setError)
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const [trail] = createResource(
		() => ({ site: site(), parent: parentId() ?? null }),
		({ site: siteRow, parent: parentKey }): Promise<Crumb[]> => siteTrail(siteRow, parentKey),
	)
	const [children] = createRowsFor(
		id,
		(key: number) => fetch_locations({ parent: key }),
		setError,
	)
	const [racks] = createRowsFor(id, (key: number) => fetch_racks({ location: key }), setError)
	// Devices have no location filter on the API, so scope by site and
	// narrow to this location client-side.
	const [siteDevices] = createRowsFor(
		siteId,
		(key: number) => fetch_devices({ site: key }),
		setError,
	)

	const handleDelete = useDetailDelete({
		noun: 'noun.location',
		name: () => location()?.name,
		id: props.id,
		remove: delete_location,
		setError,
		listRoute: '/locations',
	})

	return (
		<div>
			<DetailShell
				name={location()?.name}
				crumbs={trail()}
				record={location}
				loadingText={t('location.loadingOne')}
				emptyText={t('location.notFound')}
			>
				<DetailHeader
					name={location()?.name}
					slug={location()?.slug}
					editHref={`/locations/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={location()?.description} />

				<DetailCard label={t('location.details')}>
					<dt>{t('common.slug')}</dt>
					<dd>
						<code>{location()?.slug}</code>
					</dd>
					<dt>{t('location.type')}</dt>
					<dd>
						<IconLabel icon={locationTypeIcon(location()?.type ?? 'other')}>
							{locationTypeLabel(location()?.type ?? 'other')}
						</IconLabel>
					</dd>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<RecordLink id={tenantId()} record={tenant} base="/tenants" />
					</dd>
					<dt>{tp('entity.site', 1)}</dt>
					<dd>
						<RecordLink id={siteId()} record={site} base="/sites" />
					</dd>
					<dt>{t('site.parentLocation')}</dt>
					<dd>
						<RecordLink id={parentId()} record={parent} base="/locations" />
					</dd>
					<dt>{t('common.description')}</dt>
					<dd>{location()?.description || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="location-children"
				title={t('location.children')}
				rows={children}
				loadingText={t('location.loadingChildren')}
				emptyText={t('location.noChildren')}
				customizable
				columns={[
					nameColumn<LocationRow>(t('common.name'), '/locations'),
					{
						key: 'slug',
						label: t('common.slug'),
						getValue: (l: LocationRow): JSX.Element => <code>{l.slug}</code>,
					},
				]}
			/>

			<RelatedSection
				id="location-racks"
				title={tp('entity.rack', 2)}
				noun="noun.rack"
				rows={racks}
				emptyText={t('location.noRacks')}
				customizable
				columns={[nameColumn<RackRow>(t('common.name'), '/racks'), rackHeightColumn()]}
			/>

			<RelatedSection
				id="location-devices"
				title={tp('entity.device', 2)}
				noun="noun.device"
				rows={siteDevices}
				select={(rows: DeviceRow[]) => rows.filter((d) => d.location_id === props.id)}
				emptyText={t('location.noDevices')}
				customizable
				columns={[nameColumn<DeviceRow>(t('common.name'), '/devices')]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
