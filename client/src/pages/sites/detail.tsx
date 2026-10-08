import { createMemo, createResource, createSignal, type JSX, Show } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../../api/devices'
import { fetch_racks, type RackRow } from '../../api/racks'
import {
	delete_site,
	fetch_locations,
	fetch_site,
	fetch_site_group,
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
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import { locationTypeLabel } from '../../i18n/labels'
import { locationTypeIcon } from '../../lib/icons'
import { createRecord, createRowsFor } from '../../lib/resource'
import { siteGroupTrail } from '../../lib/trails'
import { LocationTreeName } from '../locations/list'
import { rackHeightColumn } from '../racks/columns'

/** The flat location list in tree preorder (siblings by name), with depths. */
function treeOrder(rows: readonly LocationRow[]): { row: LocationRow; depth: number }[] {
	const children = new Map<number | null, LocationRow[]>()
	const ids = new Set(rows.map((row) => row.id))
	for (const row of rows) {
		// Locations whose parent is not listed become roots.
		const parent = row.parent_id !== null && ids.has(row.parent_id) ? row.parent_id : null
		children.set(parent, [...(children.get(parent) ?? []), row])
	}
	const out: { row: LocationRow; depth: number }[] = []
	const visit = (parent: number | null, depth: number): void => {
		const level = [...(children.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
		for (const row of level) {
			out.push({ row, depth })
			visit(row.id, depth + 1)
		}
	}
	visit(null, 0)
	return out
}

/** Address as "street" over "postcode city", or a dash when empty. */
function SiteAddress(props: {
	street?: string | null
	postcode?: string | null
	city?: string | null
}): JSX.Element {
	const place = (): string => [props.postcode, props.city].filter(Boolean).join(' ')
	return (
		<Show when={props.street || place()} fallback="—">
			{props.street}
			<Show when={props.street && place()}>
				<br />
			</Show>
			{place()}
		</Show>
	)
}

/**
 * /sites/:id — site detail: header with description, the detail grid,
 * and the related locations/racks/devices sections.
 */
export function SiteDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [site] = createRecord(id, fetch_site, setError)
	const tenantId = (): number | null | undefined => site()?.tenant_id
	const groupId = (): number | null | undefined => site()?.site_group_id
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const [siteGroup] = createRecord(groupId, fetch_site_group, setError)
	const [trail] = createResource(() => groupId() ?? null, siteGroupTrail)
	const [locations] = createRowsFor(id, (key: number) => fetch_locations({ site: key }), setError)
	const [racks] = createRowsFor(id, (key: number) => fetch_racks({ site: key }), setError)
	const [devices] = createRowsFor(id, (key: number) => fetch_devices({ site: key }), setError)
	const tree = createMemo(() => treeOrder(locations() ?? []))
	const depthOf = createMemo(() => new Map(tree().map((entry) => [entry.row.id, entry.depth])))

	const handleDelete = useDetailDelete({
		noun: 'noun.site',
		name: () => site()?.name,
		id: props.id,
		remove: delete_site,
		setError,
		listRoute: '/sites',
	})

	return (
		<div>
			<DetailShell
				name={site()?.name}
				crumbs={trail()}
				record={site}
				loadingText={t('site.loadingOne')}
				emptyText={t('site.notFound')}
			>
				<DetailHeader
					name={site()?.name}
					editHref={`/sites/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={site()?.description} />

				<DetailCard label={t('site.details')}>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<RecordLink id={tenantId()} record={tenant} base="/tenants" />
					</dd>
					<dt>{t('common.group')}</dt>
					<dd>
						<RecordLink id={groupId()} record={siteGroup} base="/site-groups" />
					</dd>
					<dt>{t('common.comments')}</dt>
					<dd>
						<Markdown text={site()?.comments} />
					</dd>
					<dt>{t('site.physicalAddress')}</dt>
					<dd>
						<SiteAddress
							street={site()?.physical_street}
							postcode={site()?.physical_postcode}
							city={site()?.physical_city}
						/>
					</dd>
					<dt>{t('site.shippingAddress')}</dt>
					<dd>
						<SiteAddress
							street={site()?.shipping_street}
							postcode={site()?.shipping_postcode}
							city={site()?.shipping_city}
						/>
					</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="site-locations"
				title={tp('entity.location', 2)}
				noun="noun.location"
				rows={locations}
				select={() => tree().map((entry) => entry.row)}
				emptyText={t('site.noLocations')}
				viewAllHref={`/locations?site=${props.id}`}
				columns={[
					{
						key: 'name',
						label: tp('entity.location', 1),
						getValue: (l: LocationRow): JSX.Element => (
							<LocationTreeName location={l} depth={depthOf().get(l.id) ?? 0} />
						),
					},
					{
						key: 'type',
						label: t('location.type'),
						getValue: (l: LocationRow): JSX.Element => (
							<IconLabel icon={locationTypeIcon(l.type)}>
								{locationTypeLabel(l.type)}
							</IconLabel>
						),
					},
				]}
			/>

			<RelatedSection
				id="site-racks"
				title={tp('entity.rack', 2)}
				noun="noun.rack"
				rows={racks}
				emptyText={t('site.noRacks')}
				columns={[nameColumn<RackRow>(t('common.name'), '/racks'), rackHeightColumn()]}
			/>

			<RelatedSection
				id="site-devices"
				title={tp('entity.device', 2)}
				noun="noun.device"
				rows={devices}
				emptyText={t('site.noDevices')}
				columns={[nameColumn<DeviceRow>(t('common.name'), '/devices')]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
