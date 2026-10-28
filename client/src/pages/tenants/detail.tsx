import {
	type FindingKind,
	primaryEmail,
	type TenantBundleJson,
	websiteUrl,
} from 'shared/src/schemas'
import { createSignal, For, type JSX, type Resource, Show } from 'solid-js'
import { type FloorplanListJson, fetch_floorplans } from '../../api/attachments'
import { fetch_changelog, type ObjectChangeJson } from '../../api/changelog'
import { fetch_device_roles } from '../../api/device_roles'
import {
	type DeviceListItem,
	type DeviceRow,
	fetch_device_list,
	fetch_devices,
} from '../../api/devices'
import { type EmployeeRow, fetch_employees } from '../../api/employees'
import { fetch_racks, type RackRow } from '../../api/racks'
import {
	delete_tenant,
	fetch_site_groups,
	fetch_sites,
	fetch_tenant,
	fetch_tenant_group,
	type SiteGroupRow,
	type SiteRow,
	type TenantDetail,
	type TenantGroupRow,
} from '../../api/tenancy'
import { EmailList, PhoneList } from '../../components/contacts'
import { type DataTableColumn, nameColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	RecordLink,
	RelatedPreview,
	type RelatedTab,
	RelatedTabs,
	useDetailDelete,
} from '../../components/detail_page'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import {
	deviceRoleLabel,
	deviceStatusLabel,
	findingKindLabel,
	providerLabel,
} from '../../i18n/labels'
import { useNameOf } from '../../lib/lookup'
import { createRecord, createRows, createRowsFor } from '../../lib/resource'
import { can } from '../../lib/session'
import { formatRelative } from '../../lib/time'
import { ChangeActionBadge, ChangedObjectLink, changeUser } from '../changelog/common'
import { deviceListHref } from '../devices/list'
import { EmailLink } from '../employees/list'
import {
	type TenantIntegration,
	tenantReportHref,
	useTenantIntegrations,
} from '../integrations/cards'
import { rackHeightColumn } from '../racks/columns'
import { TenantTickets } from '../tickets/tenant_tickets'

/** Changes listed in the "Recent changes" card. */
const RECENT_CHANGES = 5

/**
 * /tenants/:id — tenant dashboard: "Needs attention" (integration
 * findings), open tickets, site cards and the related devices/employees/
 * racks/VMs/site groups (if any) as tabs on the left; the details and the recent
 * changes on the right.
 */
export function TenantDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [tenant] = createRecord(id, fetch_tenant, setError)
	const groupId = (): number | null | undefined => tenant()?.tenant_group_id
	// A group that fails to load just shows as its id.
	const [group] = createRecord(groupId, fetch_tenant_group)
	const [sites] = createRowsFor(id, (key: number) => fetch_sites({ tenant: key }), setError)
	const [siteGroups] = createRowsFor(
		id,
		(key: number) => fetch_site_groups({ tenant: key }),
		setError,
	)
	// Pages, not rows: the tabs count the totals beyond the first page.
	const [rackPage] = createRecord(id, (key: number) => fetch_racks({ tenant: key }), setError)
	const [devicePage] = createRecord(id, (key: number) => fetch_devices({ tenant: key }), setError)
	const [vmPage] = createRecord(
		id,
		(key: number) => fetch_device_list({ tenant: key, kind: 'vm' }),
		setError,
	)
	const [employeePage] = createRecord(
		id,
		(key: number) => fetch_employees({ tenant: key }),
		setError,
	)
	const [roles] = createRows(fetch_device_roles, setError)
	const racks = (): RackRow[] => rackPage()?.items ?? []
	const devices = (): DeviceRow[] => devicePage()?.items ?? []
	const employees = (): EmployeeRow[] => employeePage()?.items ?? []
	const siteName = useNameOf(sites)
	const rackName = useNameOf(racks)
	const roleName = useNameOf(roles, deviceRoleLabel)
	const employeeName = useNameOf(employees)
	const [floorplans] = createRowsFor(
		id,
		(key: number) => fetch_floorplans({ tenant: key }),
		setError,
	)
	const [changes] = createRecord(
		() => (can('changelog.view') ? id() : null),
		(key: number) => fetch_changelog({ tenant: key, limit: RECENT_CHANGES }),
		setError,
	)
	const integrations = useTenantIntegrations(id)

	const handleDelete = useDetailDelete({
		noun: 'noun.tenant',
		name: () => tenant()?.name,
		id: props.id,
		remove: delete_tenant,
		setError,
		listRoute: '/tenants',
	})

	const deviceColumns: DataTableColumn<DeviceRow>[] = [
		nameColumn<DeviceRow>(t('common.name'), '/devices'),
		roleColumn<DeviceRow>(roleName),
		{
			key: 'site',
			label: t('tenant.siteRack'),
			getValue: (d: DeviceRow): string => siteRackLabel(d, siteName, rackName),
		},
		employeeColumn<DeviceRow>(employeeName),
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
	const rackColumns: DataTableColumn<RackRow>[] = [
		nameColumn<RackRow>(t('common.name'), '/racks'),
		{
			key: 'site',
			label: tp('entity.site', 1),
			getValue: (r: RackRow): string => siteName(r.site_id),
		},
		rackHeightColumn(),
	]
	const vmColumns: DataTableColumn<DeviceListItem>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (vm: DeviceListItem): JSX.Element => (
				<a href={deviceListHref(vm)}>{vm.name}</a>
			),
		},
		statusColumn<DeviceListItem>(),
		roleColumn<DeviceListItem>(roleName),
		{
			key: 'host',
			label: t('vm.host'),
			getValue: vmHost,
		},
		employeeColumn<DeviceListItem>(employeeName),
	]
	const siteGroupColumns: DataTableColumn<SiteGroupRow>[] = [
		nameColumn<SiteGroupRow>(t('common.name'), '/site-groups'),
	]

	const tabs = (): RelatedTab[] => {
		const result: RelatedTab[] = [
			{
				key: 'devices',
				label: tp('entity.device', 2),
				count: devicePage()?.total ?? 0,
				viewAllHref: `/devices?tenant=${props.id}&kind=device`,
				content: () => (
					<RelatedPreview
						rows={devices()}
						loading={devicePage.loading}
						noun="noun.device"
						emptyText={t('tenant.noDevices')}
						columns={deviceColumns}
					/>
				),
			},
			{
				key: 'employees',
				label: tp('entity.employee', 2),
				count: employeePage()?.total ?? 0,
				viewAllHref: `/employees?tenant=${props.id}`,
				content: () => (
					<RelatedPreview
						rows={employees()}
						loading={employeePage.loading}
						noun="noun.employee"
						emptyText={t('tenant.noEmployees')}
						columns={employeeColumns}
					/>
				),
			},
			{
				key: 'racks',
				label: tp('entity.rack', 2),
				count: rackPage()?.total ?? 0,
				viewAllHref: `/racks?tenant=${props.id}`,
				content: () => (
					<RelatedPreview
						rows={racks()}
						loading={rackPage.loading}
						noun="noun.rack"
						emptyText={t('tenant.noRacks')}
						columns={rackColumns}
					/>
				),
			},
			{
				key: 'vms',
				label: tp('entity.virtualMachine', 2),
				count: vmPage()?.total ?? 0,
				viewAllHref: `/devices?tenant=${props.id}&kind=vm`,
				content: () => (
					<RelatedPreview
						rows={vmPage()?.items ?? []}
						loading={vmPage.loading}
						noun="noun.virtualMachine"
						emptyText={t('tenant.noVms')}
						columns={vmColumns}
					/>
				),
			},
		]
		const groups = siteGroups() ?? []
		if (groups.length > 0) {
			result.push({
				key: 'site-groups',
				label: tp('entity.siteGroup', 2),
				count: groups.length,
				viewAllHref: `/site-groups?tenant=${props.id}`,
				content: () => (
					<RelatedPreview
						rows={groups}
						loading={siteGroups.loading}
						noun="noun.siteGroup"
						emptyText={t('tenant.noSiteGroups')}
						columns={siteGroupColumns}
					/>
				),
			})
		}
		return result
	}

	return (
		<div class="tenant-detail">
			<DetailShell
				name={tenant()?.name}
				record={tenant}
				loadingText={t('tenant.loadingOne')}
				emptyText={t('tenant.notFound')}
			>
				<DetailHeader
					name={tenant()?.name}
					editHref={`/tenants/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<Subheading tenant={tenant()} group={group} />

				<div class="tenant-dashboard">
					<div>
						<NeedsAttention tenantId={props.id} integrations={integrations() ?? []} />
						<TenantTickets tenantId={props.id} />
						<SitesCard
							tenantId={props.id}
							sites={sites() ?? []}
							loading={sites.loading}
							racks={racks()}
							devices={devices()}
							floorplans={floorplans() ?? []}
						/>
						<RelatedTabs
							id="tenant-related"
							label={t('tenant.related')}
							tabs={tabs()}
						/>
					</div>

					<div>
						<DetailsCard tenant={tenant()} />
						<Show when={can('changelog.view')}>
							<RecentChanges
								tenantId={props.id}
								changes={changes()?.items ?? []}
								loading={changes.loading}
							/>
						</Show>
					</div>
				</div>
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}

/** Customer number, tenant group and managed bundles. */
function Subheading(props: {
	tenant: TenantDetail | null | undefined
	group: Resource<TenantGroupRow | null>
}): JSX.Element {
	const groupId = (): number | null | undefined => props.tenant?.tenant_group_id
	const hasGroup = (): boolean => groupId() !== null && groupId() !== undefined
	const hasNumber = (): boolean => Boolean(props.tenant?.customer_number)
	const hasBundles = (): boolean => (props.tenant?.bundles?.length ?? 0) > 0
	return (
		<div class="tenant-subheading">
			<Show when={hasNumber()}>
				<span class="page-subtitle">#{props.tenant?.customer_number}</span>
			</Show>
			<Show when={hasGroup() && hasNumber()}>
				<span class="page-subtitle">·</span>
			</Show>
			<Show when={hasGroup()}>
				<RecordLink id={groupId()} record={props.group} base="/tenant-groups" />
			</Show>
			<Show when={hasBundles() && (hasNumber() || hasGroup())}>
				<span class="page-subtitle">·</span>
			</Show>
			<For each={props.tenant?.bundles}>
				{(bundle: TenantBundleJson): JSX.Element => (
					<span class="badge tenant-bundle">
						{bundle.managed_bundle_name} · {bundle.service_level_name}
					</span>
				)}
			</For>
		</div>
	)
}

/** Website, emails, phones and comments. */
function DetailsCard(props: { tenant: TenantDetail | null | undefined }): JSX.Element {
	return (
		<section class="card" aria-labelledby="tenant-details">
			<div class="card-header">
				<h3 id="tenant-details">{t('tenant.details')}</h3>
			</div>
			<dl class="detail-grid tenant-facts">
				<dt>{t('tenant.website')}</dt>
				<dd>
					<Show when={props.tenant?.website} fallback="—">
						{(website: () => string): JSX.Element => (
							<a
								href={websiteUrl(website())}
								target="_blank"
								rel="noopener noreferrer"
							>
								{website()}
							</a>
						)}
					</Show>
				</dd>
				<dt>{t('employee.emails')}</dt>
				<dd>
					<EmailList emails={props.tenant?.emails ?? []} />
				</dd>
				<dt>{t('employee.phones')}</dt>
				<dd>
					<PhoneList phones={props.tenant?.phones ?? []} />
				</dd>
			</dl>
			<Show when={props.tenant?.comments}>
				<details class="tenant-comments">
					<summary>{t('common.comments')}</summary>
					<Markdown text={props.tenant?.comments} />
				</details>
			</Show>
		</section>
	)
}

interface AttentionItem {
	entry: TenantIntegration
	kind: FindingKind
	count: number
}

/** Integration findings of the tenant, one row per finding kind. */
function NeedsAttention(props: {
	tenantId: number
	integrations: TenantIntegration[]
}): JSX.Element {
	const items = (): AttentionItem[] =>
		props.integrations.flatMap((entry: TenantIntegration) =>
			(Object.entries(entry.status?.finding_counts ?? {}) as [FindingKind, number][])
				.filter(([, count]) => count > 0)
				.map(([kind, count]) => ({ entry, kind, count })),
		)
	return (
		<Show when={items().length > 0}>
			<section class="card" aria-labelledby="tenant-attention">
				<div class="card-header">
					<h3 id="tenant-attention">
						{t('tenant.needsAttention')} <span class="badge">{items().length}</span>
					</h3>
					<Show when={props.integrations.length === 1 && props.integrations[0]}>
						{(entry: () => TenantIntegration) => (
							<a href={tenantReportHref(entry().integration, props.tenantId)}>
								{t('integration.openReport')}
							</a>
						)}
					</Show>
				</div>
				<ul class="tenant-rows">
					<For each={items()}>
						{(item: AttentionItem): JSX.Element => (
							<AttentionRow tenantId={props.tenantId} item={item} />
						)}
					</For>
				</ul>
			</section>
		</Show>
	)
}

function AttentionRow(props: { tenantId: number; item: AttentionItem }): JSX.Element {
	return (
		<li>
			<span class="tenant-tag">{providerLabel(props.item.entry.integration.provider)}</span>
			<span class="tenant-row-text">
				{t('tenant.findingCount', {
					kind: findingKindLabel(props.item.kind),
					count: props.item.count,
				})}
			</span>
			<a
				href={tenantReportHref(
					props.item.entry.integration,
					props.tenantId,
					props.item.kind,
				)}
			>
				{t('tenant.review')}
			</a>
		</li>
	)
}

/** One card per site with its rack/device counts and floor plan/racks links. */
function SitesCard(props: {
	tenantId: number
	sites: SiteRow[]
	loading: boolean
	racks: RackRow[]
	devices: DeviceRow[]
	floorplans: FloorplanListJson[]
}): JSX.Element {
	return (
		<section class="card" aria-labelledby="tenant-sites">
			<div class="card-header">
				<h3 id="tenant-sites">
					{tp('entity.site', 2)} <span class="badge">{props.sites.length}</span>
				</h3>
				<a href={`/sites?tenant=${props.tenantId}`}>
					{t('common.viewIn', { target: tp('entity.site', 2) })}
				</a>
			</div>
			<Show
				when={!props.loading}
				fallback={<Loading message={t('list.loading', { noun: tp('noun.site', 2) })} />}
			>
				<Show
					when={props.sites.length > 0}
					fallback={<Empty message={t('tenant.noSites')} />}
				>
					<div class="tenant-site-grid">
						<For each={props.sites}>
							{(site: SiteRow): JSX.Element => (
								<SiteCard
									tenantId={props.tenantId}
									site={site}
									racks={props.racks}
									devices={props.devices}
									floorplans={props.floorplans}
								/>
							)}
						</For>
					</div>
				</Show>
			</Show>
		</section>
	)
}

function SiteCard(props: {
	tenantId: number
	site: SiteRow
	racks: RackRow[]
	devices: DeviceRow[]
	floorplans: FloorplanListJson[]
}): JSX.Element {
	const rackCount = (): number =>
		props.racks.filter((r: RackRow) => r.site_id === props.site.id).length
	const deviceCount = (): number =>
		props.devices.filter((d: DeviceRow) => d.site_id === props.site.id).length
	const sitePlan = (): FloorplanListJson | undefined =>
		props.floorplans.find(
			(p: FloorplanListJson) => p.site_id === props.site.id && p.location_id === null,
		)
	return (
		<div class="tenant-site">
			<a class="tenant-site-name" href={`/sites/${props.site.id}`}>
				{props.site.name}
			</a>
			<span class="text-muted">
				<a href={`/racks?site=${props.site.id}`}>{tp('tenant.siteRacks', rackCount())}</a>
				{' · '}
				<a href={`/devices?tenant=${props.tenantId}&site=${props.site.id}&kind=device`}>
					{tp('tenant.siteDevices', deviceCount())}
				</a>
				{' · '}
				<Show when={sitePlan()} fallback={t('tenant.noFloorplan')}>
					{(plan: () => FloorplanListJson) => (
						<a href={`/floorplans/${plan().attachment_id}`}>
							{tp('entity.floorplan', 1)}
						</a>
					)}
				</Show>
			</span>
		</div>
	)
}

/** Latest changelog entries of the tenant's objects. */
function RecentChanges(props: {
	tenantId: number
	changes: ObjectChangeJson[]
	loading: boolean
}): JSX.Element {
	return (
		<section class="card" aria-labelledby="tenant-changes">
			<div class="card-header">
				<h3 id="tenant-changes">{t('tenant.recentChanges')}</h3>
				<a href={`/changelog?tenant=${props.tenantId}`}>
					{t('common.viewIn', { target: t('entity.changelog') })}
				</a>
			</div>
			<Show
				when={!props.loading}
				fallback={<Loading message={t('list.loading', { noun: tp('noun.change', 2) })} />}
			>
				<Show
					when={props.changes.length > 0}
					fallback={<Empty message={t('changelog.empty')} />}
				>
					<ul class="tenant-rows tenant-changes">
						<For each={props.changes}>
							{(change: ObjectChangeJson): JSX.Element => (
								<ChangeRow change={change} />
							)}
						</For>
					</ul>
				</Show>
			</Show>
		</section>
	)
}

function ChangeRow(props: { change: ObjectChangeJson }): JSX.Element {
	return (
		<li>
			<a class="text-muted" href={`/changelog/${props.change.id}`}>
				{formatRelative(props.change.created_at)}
			</a>
			<span class="tenant-row-text">
				<strong>{changeUser(props.change)}</strong>{' '}
				<ChangeActionBadge action={props.change.action} />{' '}
				<ChangedObjectLink change={props.change} />
			</span>
		</li>
	)
}

/** Host device link of a VM, or "Cloud" for a VM without host. */
export function vmHost(vm: DeviceListItem): JSX.Element {
	if (vm.kind === 'vm' && vm.host_device_id !== null) {
		return <a href={`/devices/${vm.host_device_id}`}>{vm.host_name}</a>
	}
	return <span>{t('deviceRoleIcon.cloud')}</span>
}

/** Status pill of a device or VM. */
export function statusColumn<Row extends { status: string }>(): DataTableColumn<Row> {
	return {
		key: 'status',
		label: t('common.status'),
		getValue: (row: Row): JSX.Element => (
			<span class={`badge badge-${row.status}`}>{deviceStatusLabel(row.status)}</span>
		),
	}
}

export function roleColumn<Row extends { device_role_id: number }>(
	roleName: (id: number) => string,
): DataTableColumn<Row> {
	return {
		key: 'role',
		label: tp('entity.deviceRole', 1),
		getValue: (row: Row): string => roleName(row.device_role_id),
	}
}

export function employeeColumn<Row extends { employee_id: number | null }>(
	employeeName: (id: number) => string,
): DataTableColumn<Row> {
	return {
		key: 'employee',
		label: t('device.assignedEmployee'),
		getValue: (row: Row): JSX.Element => (
			<Show when={row.employee_id} fallback="—">
				{(employee: () => number) => (
					<a href={`/employees/${employee()}`}>{employeeName(employee())}</a>
				)}
			</Show>
		),
	}
}

/** `Site / Rack U<position>` of a device, as far as it is placed. */
function siteRackLabel(
	d: DeviceRow,
	siteName: (id: number) => string,
	rackName: (id: number) => string,
): string {
	const parts: string[] = []
	if (d.site_id !== null) {
		parts.push(siteName(d.site_id))
	}
	if (d.rack_id !== null) {
		parts.push(
			d.position_u === null
				? rackName(d.rack_id)
				: t('device.mountPosition', { rack: rackName(d.rack_id), u: d.position_u }),
		)
	}
	return parts.length > 0 ? parts.join(' / ') : '—'
}
