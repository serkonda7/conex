import type { LocationOutletJson } from 'shared/src/types'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import {
	type AttachmentJson,
	type FloorplanLinkJson,
	fetch_attachment,
	fetch_floorplan_links,
} from '../../api/attachments'
import { fetch_device_roles } from '../../api/device_roles'
import { type DeviceListDevice, type DeviceListItem, fetch_device_list } from '../../api/devices'
import { fetch_racks, type RackRow } from '../../api/racks'
import { fetch_device_types } from '../../api/templates'
import {
	delete_location,
	fetch_location,
	fetch_location_outlets,
	fetch_locations,
	fetch_site,
	fetch_tenant,
	type LocationListRow,
} from '../../api/tenancy'
import { AttachmentsSection, createOwnerImages } from '../../components/attachments'
import { type DataTableColumn, descriptionColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RecordLink,
	RelatedPreview,
	type RelatedTab,
	RelatedTabs,
	useDetailDelete,
} from '../../components/detail_page'
import { Empty, InlineError } from '../../components/feedback'
import { FloorplanPreview } from '../../components/floorplan_preview'
import { IconLabel } from '../../components/icon_label'
import type { PluralKey } from '../../i18n'
import { t, tp } from '../../i18n'
import { deviceRoleLabel, locationTypeLabel } from '../../i18n/labels'
import { floorplanHref } from '../../lib/floorplan_link'
import { deviceRoleIcon, locationTypeIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createDerived, createRecord, createRows, createRowsFor } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { siteTrail } from '../../lib/trails'
import { DeviceStatusBadge } from '../devices/status'
import { rackHeightColumn } from '../racks/columns'

/** A location name with its type icon, linked unless it is the current one. */
function LocationName(props: { location: LocationListRow; current?: boolean }): JSX.Element {
	return (
		<IconLabel icon={locationTypeIcon(props.location.type)}>
			<Show
				when={!props.current}
				fallback={<strong aria-current="page">{props.location.name}</strong>}
			>
				<a href={`/locations/${props.location.id}`}>{props.location.name}</a>
			</Show>
		</IconLabel>
	)
}

/**
 * The site, the location's ancestors, the location itself and its
 * children, indented by depth.
 */
function LocationHierarchy(props: {
	id: number
	site: Crumb | undefined
	locations: LocationListRow[]
}): JSX.Element {
	const byId = createMemo(() => new Map(props.locations.map((l) => [l.id, l])))
	/** Ancestors, outermost first, then the location itself. */
	const path = createMemo((): LocationListRow[] => {
		const chain: LocationListRow[] = []
		let next = byId().get(props.id)
		while (next && chain.length < 32) {
			chain.unshift(next)
			next = next.parent_id === null ? undefined : byId().get(next.parent_id)
		}
		return chain
	})
	const children = createMemo(() => props.locations.filter((l) => l.parent_id === props.id))
	const indent = (depth: number): JSX.CSSProperties => ({ '--tree-depth': depth })
	return (
		<ul class="location-tree">
			<Show when={props.site}>
				{(site: () => Crumb) => (
					<li style={indent(0)}>
						<a href={site().href}>{site().label}</a>
					</li>
				)}
			</Show>
			<For each={path()}>
				{(location: LocationListRow, index: () => number) => (
					<li
						style={indent(index() + 1)}
						classList={{ current: location.id === props.id }}
					>
						<LocationName location={location} current={location.id === props.id} />
					</li>
				)}
			</For>
			<For each={children()}>
				{(child: LocationListRow) => (
					<li style={indent(path().length + 1)}>
						<LocationName location={child} />
					</li>
				)}
			</For>
		</ul>
	)
}

/** One flat related-object tab listing all its rows. */
function locationTab<Row extends { id: number }>(opts: {
	key: string
	label: string
	rows: () => Row[] | undefined
	loading: () => boolean
	noun: PluralKey
	emptyText: string
	columns: DataTableColumn<Row>[]
}): RelatedTab {
	return {
		key: opts.key,
		label: opts.label,
		count: (opts.rows() ?? []).length,
		content: (): JSX.Element => (
			<RelatedPreview
				rows={opts.rows() ?? []}
				loading={opts.loading()}
				all
				columnLines
				noun={opts.noun}
				emptyText={opts.emptyText}
				columns={opts.columns}
			/>
		),
	}
}

/**
 * /locations/:id — location detail: header with the type icon, spec sheet
 * (general, hierarchy, floor plans), the floor plan preview and images, and
 * tabs with the racks, devices and outlets.
 */
export function LocationDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [location] = createRecord(id, fetch_location, setError)
	const siteId = (): number | undefined => location()?.site_id
	const parentId = (): number | null | undefined => location()?.parent_id
	const tenantId = (): number | null | undefined => location()?.tenant_id
	const [site] = createRecord(siteId, fetch_site, setError)
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const trail = createDerived(
		() => ({ site: site(), parent: parentId() ?? null }),
		({ site: siteRow, parent: parentKey }): Promise<Crumb[]> => siteTrail(siteRow, parentKey),
	)
	// The whole site tree, for the hierarchy (ancestors with their types).
	const [siteLocations] = createRowsFor(
		siteId,
		(key: number) => fetch_locations({ site: [key], limit: 200 }),
		setError,
	)
	const [racks] = createRowsFor(
		id,
		(key: number) => fetch_racks({ location: [key], limit: 200 }),
		setError,
	)
	const [deviceItems] = createRowsFor(
		id,
		(key: number) => fetch_device_list({ location: key, kind: 'device', limit: 200 }),
		setError,
	)
	const devices = (): DeviceListDevice[] | undefined =>
		deviceItems()?.filter(
			(row: DeviceListItem): row is DeviceListDevice => row.kind === 'device',
		)
	// Outlets of this location and its descendants, wherever their panel sits.
	const [outlets] = createRowsFor(id, fetch_location_outlets, setError)
	const [roles] = createRows(fetch_device_roles, setError)
	const [deviceTypes] = createRows(fetch_device_types, setError)
	const roleName = useNameOf(roles, deviceRoleLabel)
	const typeName = useNameOf(deviceTypes, (type) => type.model)
	const rackName = useNameOf(racks)
	const roleIcon = (roleId: number): ReturnType<typeof deviceRoleIcon> =>
		deviceRoleIcon(roles()?.find((role) => role.id === roleId)?.icon)

	const images = createOwnerImages({ location_id: props.id }, setError)
	// Plans with an area for this location; the own plan is previewed first.
	const [planLinks] = createRowsFor(
		id,
		(key: number) => fetch_floorplan_links({ location: key }),
		setError,
	)
	const linkedPlan = (): number | undefined => planLinks()?.[0]?.attachment_id
	const [linkedAttachment] = createRecord(
		() => !images.floorplan() && linkedPlan(),
		fetch_attachment,
		setError,
	)
	const previewPlan = (): AttachmentJson | undefined =>
		images.floorplan() ?? linkedAttachment() ?? undefined

	const handleDelete = useDetailDelete({
		noun: 'noun.location',
		name: () => location()?.name,
		id: props.id,
		remove: delete_location,
		setError,
		listRoute: '/locations',
	})

	const rackColumns: DataTableColumn<RackRow>[] = [
		{
			key: 'name',
			label: t('common.name'),
			class: 'component-name',
			getValue: (r: RackRow): JSX.Element => <a href={`/racks/${r.id}`}>{r.name}</a>,
		},
		rackHeightColumn(),
		descriptionColumn<RackRow>(),
	]

	const deviceColumns: DataTableColumn<DeviceListDevice>[] = [
		{
			key: 'name',
			label: t('common.name'),
			class: 'component-name',
			getValue: (d: DeviceListDevice): JSX.Element => (
				<IconLabel icon={roleIcon(d.device_role_id)}>
					<a href={`/devices/${d.id}`}>{d.name}</a>
				</IconLabel>
			),
		},
		{
			key: 'status',
			label: t('common.status'),
			getValue: (d: DeviceListDevice): JSX.Element => <DeviceStatusBadge status={d.status} />,
		},
		{
			key: 'role',
			label: tp('entity.deviceRole', 1),
			getValue: (d: DeviceListDevice): string => roleName(d.device_role_id),
		},
		{
			key: 'type',
			label: t('common.type'),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<a href={`/device-types/${d.device_type_id}`}>{typeName(d.device_type_id)}</a>
			),
		},
		{
			key: 'rack',
			label: tp('entity.rack', 1),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<Show when={d.rack_id} fallback="—">
					{(rack: () => number) => (
						<a href={`/racks/${rack()}`}>
							{d.position_u === null
								? d.shelf_id === null
									? rackName(rack())
									: `${rackName(rack())} · ${t('elevation.onShelf')}`
								: t('device.mountPosition', {
										rack: rackName(rack()),
										u: d.position_u,
									})}
						</a>
					)}
				</Show>
			),
		},
	]

	const outletColumns: DataTableColumn<LocationOutletJson>[] = [
		{
			key: 'panel',
			label: t('location.outletPanel'),
			class: 'component-name',
			getValue: (o: LocationOutletJson): JSX.Element => (
				<a href={`/devices/${o.device_id}`}>{o.device_name}</a>
			),
		},
		{
			key: 'port',
			label: t('location.outletPort'),
			getValue: (o: LocationOutletJson): JSX.Element => <code>{o.name}</code>,
		},
		{
			key: 'location',
			label: tp('entity.location', 1),
			getValue: (o: LocationOutletJson): JSX.Element => (
				<a href={`/locations/${o.location_id}`}>{o.location_name}</a>
			),
		},
		{
			key: 'peer',
			label: t('location.outletPeer'),
			getValue: (o: LocationOutletJson): JSX.Element => (
				<Show when={o.peer} fallback="—">
					{(peer: () => NonNullable<LocationOutletJson['peer']>): JSX.Element => (
						<span>
							<a href={`/devices/${peer().device_id}`}>{peer().device_name}</a>{' '}
							<code>{peer().interface_name}</code>
						</span>
					)}
				</Show>
			),
		},
	]

	const tabs = (): RelatedTab[] => [
		locationTab({
			key: 'racks',
			label: tp('entity.rack', 2),
			rows: racks,
			loading: () => racks.loading,
			noun: 'noun.rack',
			emptyText: t('location.noRacks'),
			columns: rackColumns,
		}),
		locationTab({
			key: 'devices',
			label: tp('entity.device', 2),
			rows: devices,
			loading: () => deviceItems.loading,
			noun: 'noun.device',
			emptyText: t('location.noDevices'),
			columns: deviceColumns,
		}),
		locationTab({
			key: 'outlets',
			label: tp('entity.outlet', 2),
			rows: outlets,
			loading: () => outlets.loading,
			noun: 'noun.outlet',
			emptyText: t('location.noOutlets'),
			columns: outletColumns,
		}),
	]

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
					icon={locationTypeIcon(location()?.type ?? 'other')}
					editHref={`/locations/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={location()?.description} />

				<div class="detail-overview">
					<section class="spec-sheet stacked" aria-label={t('location.details')}>
						<section>
							<h4>{t('location.section.general')}</h4>
							<dl>
								<dt>{t('common.type')}</dt>
								<dd>{locationTypeLabel(location()?.type ?? 'other')}</dd>
								<dt>{tp('entity.tenant', 1)}</dt>
								<dd>
									<RecordLink id={tenantId()} record={tenant} base="/tenants" />
								</dd>
							</dl>
						</section>
						<section>
							<h4>{t('location.section.hierarchy')}</h4>
							<LocationHierarchy
								id={props.id}
								site={trail()?.[0]}
								locations={siteLocations() ?? []}
							/>
						</section>
						<section>
							<h4>{tp('entity.floorplan', 2)}</h4>
							<dl>
								<dt>{t('location.ownFloorplan')}</dt>
								<dd>
									<Show when={images.floorplan()} fallback="—">
										{(plan: () => AttachmentJson) => (
											<a href={`/floorplans/${plan().id}`}>
												{t('location.openFloorplan')}
											</a>
										)}
									</Show>
								</dd>
								<dt>{t('floorplan.linkedFrom')}</dt>
								<dd>
									<Show when={(planLinks() ?? []).length > 0} fallback="—">
										<For each={planLinks()}>
											{(link: FloorplanLinkJson, index: () => number) => (
												<>
													<Show when={index() > 0}>{', '}</Show>
													<a
														href={floorplanHref(link.attachment_id, {
															location: props.id,
														})}
													>
														{link.owner_name}
													</a>
												</>
											)}
										</For>
									</Show>
								</dd>
							</dl>
						</section>
					</section>

					<div>
						<section aria-labelledby="location-floorplan">
							<div class="section-header">
								<h3 id="location-floorplan">{tp('entity.floorplan', 1)}</h3>
							</div>
							<Show
								when={previewPlan()}
								fallback={<Empty message={t('location.noFloorplan')} />}
							>
								{(plan: () => AttachmentJson) => (
									<FloorplanPreview
										attachment={plan()}
										highlight={props.id}
										onError={setError}
									/>
								)}
							</Show>
						</section>
						<AttachmentsSection id="location-attachments" images={images} />
					</div>
				</div>

				<RelatedTabs
					id="location-related"
					label={t('location.related')}
					class="flat-table"
					tabs={tabs()}
				/>
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}
