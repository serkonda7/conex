import { createSignal, type JSX } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../../api/devices'
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
import { t, tp } from '../../i18n'
import { createRecord, createRowsFor } from '../../lib/resource'
import { EmailLink } from '../employees/list'
import { TenantIntegrationCards } from '../integrations/cards'
import { rackHeightColumn } from '../racks/columns'

/**
 * /tenants/:id — tenant detail: header with description/comments, the
 * integration cards, and the related employees/sites/site groups/racks/devices
 * tables.
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
	const [racks] = createRowsFor(id, (key: number) => fetch_racks({ tenant: key }), setError)
	const [devices] = createRowsFor(id, (key: number) => fetch_devices({ tenant: key }), setError)
	const [employees] = createRowsFor(
		id,
		(key: number) => fetch_employees({ tenant: key }),
		setError,
	)

	const handleDelete = useDetailDelete({
		noun: 'noun.tenant',
		name: () => tenant()?.name,
		id: props.id,
		remove: delete_tenant,
		setError,
		listRoute: '/tenants',
	})

	return (
		<div>
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
				<DetailSubtitle description={tenant()?.description} />

				<DetailCard label={t('tenant.details')}>
					<dt>{tp('entity.tenantGroup', 1)}</dt>
					<dd>
						<RecordLink id={groupId()} record={group} base="/tenant-groups" />
					</dd>
					<dt>{t('tenant.customerNumber')}</dt>
					<dd>{tenant()?.customer_number || '—'}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{tenant()?.comments || '—'}</dd>
				</DetailCard>
				<TenantIntegrationCards tenantId={props.id} />
			</DetailShell>

			<RelatedSection
				id="tenant-employees"
				title={tp('entity.employee', 2)}
				noun="noun.employee"
				rows={employees}
				emptyText={t('tenant.noEmployees')}
				viewAllHref={`/employees?tenant=${props.id}`}
				columns={[
					nameColumn<EmployeeRow>(t('common.name'), '/employees'),
					{
						key: 'title',
						label: t('employee.title'),
						getValue: (e: EmployeeRow): string => e.title ?? '—',
					},
					{
						key: 'email',
						label: t('employee.email'),
						getValue: (e: EmployeeRow): JSX.Element => <EmailLink email={e.email} />,
					},
				]}
			/>

			<RelatedSection
				id="tenant-sites"
				title={tp('entity.site', 2)}
				noun="noun.site"
				rows={sites}
				emptyText={t('tenant.noSites')}
				viewAllHref={`/sites?tenant=${props.id}`}
				columns={[nameColumn<SiteRow>(t('common.name'), '/sites')]}
			/>

			<RelatedSection
				id="tenant-site-groups"
				title={tp('entity.siteGroup', 2)}
				noun="noun.siteGroup"
				rows={siteGroups}
				emptyText={t('tenant.noSiteGroups')}
				viewAllHref={`/site-groups?tenant=${props.id}`}
				columns={[
					nameColumn<SiteGroupRow>(t('common.name'), '/site-groups'),
					{
						key: 'slug',
						label: t('common.slug'),
						getValue: (g: SiteGroupRow): JSX.Element => <code>{g.slug}</code>,
					},
				]}
			/>

			<RelatedSection
				id="tenant-racks"
				title={tp('entity.rack', 2)}
				noun="noun.rack"
				rows={racks}
				emptyText={t('tenant.noRacks')}
				columns={[nameColumn<RackRow>(t('common.name'), '/racks'), rackHeightColumn()]}
			/>

			<RelatedSection
				id="tenant-devices"
				title={tp('entity.device', 2)}
				noun="noun.device"
				rows={devices}
				emptyText={t('tenant.noDevices')}
				viewAllHref={`/devices?tenant=${props.id}`}
				columns={[nameColumn<DeviceRow>(t('common.name'), '/devices')]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
