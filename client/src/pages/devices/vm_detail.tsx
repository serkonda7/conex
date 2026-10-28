import { IconArrowsExchange } from '@tabler/icons-solidjs'
import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_device_role } from '../../api/device_roles'
import { fetch_device } from '../../api/devices'
import { fetch_employee } from '../../api/employees'
import { fetch_tenant } from '../../api/tenancy'
import {
	delete_virtual_machine,
	fetch_virtual_machine,
	fetch_virtual_machine_service,
	type VirtualMachineRow,
} from '../../api/virtual_machines'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	RecordLink,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { deviceRoleLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { createRecord } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { canGlobal } from '../../lib/session'
import { ManagedServicePill } from '../managed-bundles/service_pill'
import { MoveTenantDialog } from './move_tenant_dialog'

/**
 * /devices/vm/:id — virtual machine detail: role, host (or cloud), tenant
 * and assigned employee. The host device heads the breadcrumbs; only a
 * hostless VM can be moved to another tenant (a hosted one follows its host).
 */
export function VirtualMachineDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [movingTenant, setMovingTenant] = createSignal(false)
	const id = (): number => props.id

	const [vm, { refetch }] = createRecord(id, fetch_virtual_machine, setError)
	const roleId = (): number | undefined => vm()?.device_role_id
	const hostId = (): number | null | undefined => vm()?.host_device_id
	const tenantId = (): number | null | undefined => vm()?.tenant_id
	const employeeId = (): number | null | undefined => vm()?.employee_id
	const [role] = createRecord(roleId, fetch_device_role, setError)
	const [host] = createRecord(hostId, fetch_device, setError)
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const [employee] = createRecord(employeeId, fetch_employee, setError)
	// Keyed on the record so a tenant move refetches the SLA.
	const [service] = createRecord(
		() => vm(),
		(row: VirtualMachineRow) => fetch_virtual_machine_service(row.id),
		setError,
	)

	const crumbs = (): Crumb[] => {
		const row = host()
		return row ? [{ label: row.name, href: `/devices/${row.id}` }] : []
	}

	const handleDelete = useDetailDelete({
		noun: 'noun.virtualMachine',
		name: () => vm()?.name,
		id: props.id,
		remove: delete_virtual_machine,
		setError,
		listRoute: '/devices',
		detailBase: '/devices/vm',
	})

	return (
		<div>
			<DetailShell
				name={vm()?.name}
				crumbs={crumbs()}
				record={vm}
				loadingText={t('vm.loadingOne')}
				emptyText={t('vm.notFound')}
			>
				<DetailHeader
					name={vm()?.name}
					editHref={`/devices/vm/${props.id}/edit`}
					cloneHref={`/devices/vm/add?clone=${props.id}`}
					onDelete={handleDelete}
					actions={
						<Show when={canGlobal('edit') && hostId() === null}>
							<button type="button" onClick={() => setMovingTenant(true)}>
								<IconLabel icon={IconArrowsExchange}>
									{t('device.moveTenant')}
								</IconLabel>
							</button>
						</Show>
					}
				/>
				<DetailSubtitle description={vm()?.description} />
				<ManagedServicePill service={service} />

				<DetailCard label={t('vm.details')}>
					<dt>{tp('entity.deviceRole', 1)}</dt>
					<dd>
						<IconLabel icon={deviceRoleIcon(role()?.icon)}>
							<ForeignKeyLink
								id={roleId()}
								loading={role.loading}
								name={deviceRoleLabel(role())}
								href={`/device-roles/${roleId() ?? ''}`}
							/>
						</IconLabel>
					</dd>
					<dt>{t('vm.host')}</dt>
					<dd>
						<Show when={hostId() !== null} fallback={t('deviceRoleIcon.cloud')}>
							<RecordLink id={hostId()} record={host} base="/devices" />
						</Show>
					</dd>
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<RecordLink id={tenantId()} record={tenant} base="/tenants" />
					</dd>
					<dt>{t('device.assignedEmployee')}</dt>
					<dd>
						<RecordLink id={employeeId()} record={employee} base="/employees" />
					</dd>
				</DetailCard>
			</DetailShell>
			<Show when={movingTenant() ? vm() : undefined}>
				{(row: () => VirtualMachineRow): JSX.Element => (
					<MoveTenantDialog
						row={{ kind: 'vm', ...row() }}
						on_moved={() => {
							setMovingTenant(false)
							void refetch()
						}}
						on_close={() => setMovingTenant(false)}
					/>
				)}
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
