import { primaryEmail } from 'shared/src/schemas'
import { createMemo, createResource, createSignal, type JSX, Show } from 'solid-js'
import type { AttachmentJson } from '../../api/attachments'
import { fetch_device_roles } from '../../api/device_roles'
import {
	type DeviceListItem,
	type DeviceRow,
	fetch_device_list,
	fetch_devices,
} from '../../api/devices'
import { type EmployeeRow, fetch_employees } from '../../api/employees'
import { fetch_racks, type RackRow } from '../../api/racks'
import { fetch_device_types } from '../../api/templates'
import {
	delete_site,
	fetch_locations,
	fetch_site,
	fetch_site_group,
	fetch_tenant,
	type LocationRow,
} from '../../api/tenancy'
import { AttachmentsSection, createOwnerImages } from '../../components/attachments'
import { type DataTableColumn, nameColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RecordLink,
	RelatedPreview,
	type RelatedTab,
	RelatedTabs,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { FloorplanLinks } from '../../components/floorplan_links'
import { IconLabel } from '../../components/icon_label'
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import { locationTypeLabel } from '../../i18n/labels'
import { locationTypeIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRecord, createRows, createRowsFor } from '../../lib/resource'
import { siteGroupTrail } from '../../lib/trails'
import { deviceListHref } from '../devices/list'
import { EmailLink } from '../employees/list'
import { LocationTreeName } from '../locations/list'
import { rackHeightColumn } from '../racks/columns'
import { roleColumn, vmHost } from '../tenants/detail'

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
	const [locations] = createRowsFor(
		id,
		(key: number) => fetch_locations({ site: [key] }),
		setError,
	)
	const [racks] = createRowsFor(id, (key: number) => fetch_racks({ site: [key] }), setError)
	// Pages, not rows: the tab counts the total beyond the first page.
	const [devicePage] = createRecord(id, (key: number) => fetch_devices({ site: key }), setError)
	const [employeePage] = createRecord(
		tenantId,
		(key: number) => fetch_employees({ tenant: key }),
		setError,
	)
	const [vmPage] = createRecord(
		tenantId,
		(key: number) => fetch_device_list({ tenant: key, kind: 'vm' }),
		setError,
	)
	const [roles] = createRows(fetch_device_roles, setError)
	const [types] = createRows(fetch_device_types, setError)
	const devices = (): DeviceRow[] => devicePage()?.items ?? []
	const employees = (): EmployeeRow[] => employeePage()?.items ?? []
	// VMs have no site of their own: they belong to the site of their host.
	const vms = (): DeviceListItem[] => {
		const hosts = new Set(devices().map((d) => d.id))
		return (vmPage()?.items ?? []).filter(
			(vm) => vm.kind === 'vm' && vm.host_device_id !== null && hosts.has(vm.host_device_id),
		)
	}
	const roleName = useNameOf(roles)
	const typeName = useNameOf(types, (row) => row.model)
	const rackName = useNameOf(racks)
	const locationName = useNameOf(locations)
	const tree = createMemo(() => treeOrder(locations() ?? []))
	const depthOf = createMemo(() => new Map(tree().map((entry) => [entry.row.id, entry.depth])))

	const images = createOwnerImages({ site_id: props.id }, setError)

	const deviceColumns: DataTableColumn<DeviceRow>[] = [
		nameColumn<DeviceRow>(t('common.name'), '/devices'),
		roleColumn<DeviceRow>(roleName),
		{
			key: 'type',
			label: t('common.type'),
			getValue: (d: DeviceRow): string => typeName(d.device_type_id),
		},
		{
			key: 'place',
			label: t('site.locationRack'),
			getValue: (d: DeviceRow): string => {
				const parts = [
					d.location_id === null ? null : locationName(d.location_id),
					d.rack_id === null ? null : rackName(d.rack_id),
				].filter((part): part is string => part !== null)
				return parts.length > 0 ? parts.join(' / ') : '—'
			},
		},
	]
	const locationColumns: DataTableColumn<LocationRow>[] = [
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
				<IconLabel icon={locationTypeIcon(l.type)}>{locationTypeLabel(l.type)}</IconLabel>
			),
		},
	]
	const employeeColumns: DataTableColumn<EmployeeRow>[] = [
		nameColumn<EmployeeRow>(t('common.name'), '/employees'),
		{
			key: 'title',
			label: t('employee.title'),
			getValue: (e: EmployeeRow): string => e.title ?? '—',
		},
		{
			key: 'email',
			label: t('employee.email'),
			getValue: (e: EmployeeRow): JSX.Element => <EmailLink email={primaryEmail(e.emails)} />,
		},
	]
	const vmColumns: DataTableColumn<DeviceListItem>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (vm: DeviceListItem): JSX.Element => (
				<a href={deviceListHref(vm)}>{vm.name}</a>
			),
		},
		roleColumn<DeviceListItem>(roleName),
		{ key: 'host', label: t('vm.host'), getValue: vmHost },
	]

	const tabs = (): RelatedTab[] => [
		{
			key: 'devices',
			label: tp('entity.device', 2),
			count: devicePage()?.total ?? 0,
			viewAllHref: `/devices?site=${props.id}&kind=device`,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={devices()}
					loading={devicePage.loading}
					noun="noun.device"
					emptyText={t('site.noDevices')}
					columns={deviceColumns}
				/>
			),
		},
		{
			key: 'locations',
			label: tp('entity.location', 2),
			count: locations()?.length ?? 0,
			viewAllHref: `/locations?site=${props.id}`,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={tree().map((entry) => entry.row)}
					loading={locations.loading}
					noun="noun.location"
					emptyText={t('site.noLocations')}
					columns={locationColumns}
				/>
			),
		},
		{
			key: 'racks',
			label: tp('entity.rack', 2),
			count: racks()?.length ?? 0,
			viewAllHref: `/racks?site=${props.id}`,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={racks() ?? []}
					loading={racks.loading}
					noun="noun.rack"
					emptyText={t('site.noRacks')}
					columns={[nameColumn<RackRow>(t('common.name'), '/racks'), rackHeightColumn()]}
				/>
			),
		},
		{
			key: 'employees',
			label: tp('entity.employee', 2),
			count: employeePage()?.total ?? 0,
			viewAllHref: tenantId() ? `/employees?tenant=${tenantId()}` : undefined,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={employees()}
					loading={employeePage.loading}
					noun="noun.employee"
					emptyText={t('site.noEmployees')}
					columns={employeeColumns}
				/>
			),
		},
		{
			key: 'vms',
			label: tp('entity.virtualMachine', 2),
			count: vms().length,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={vms()}
					loading={vmPage.loading}
					noun="noun.virtualMachine"
					emptyText={t('site.noVms')}
					columns={vmColumns}
				/>
			),
		},
	]

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

				<div class="detail-split">
					<DetailCard label={t('site.details')}>
						<dt>{tp('entity.tenant', 1)}</dt>
						<dd>
							<RecordLink id={tenantId()} record={tenant} base="/tenants" />
						</dd>
						<dt>{t('common.group')}</dt>
						<dd>
							<RecordLink id={groupId()} record={siteGroup} base="/site-groups" />
						</dd>
						<Show when={images.floorplan()}>
							{(plan: () => AttachmentJson) => (
								<>
									<dt>{t('floorplan.title')}</dt>
									<dd>
										<a href={`/floorplans/${plan().id}`}>
											{t('floorplan.open')}
										</a>
									</dd>
								</>
							)}
						</Show>
						<FloorplanLinks
							target={{ site: props.id }}
							label="floorplan.linkedFrom"
							onError={setError}
						/>
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
					<div>
						<AttachmentsSection id="site-attachments" images={images} />
					</div>
				</div>
			</DetailShell>

			<RelatedTabs id="site-related" label={t('site.related')} tabs={tabs()} />

			<InlineError message={error()} />
		</div>
	)
}
