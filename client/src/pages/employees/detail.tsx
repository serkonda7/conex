import { primaryPhone } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../../api/devices'
import { delete_employee, fetch_employee } from '../../api/employees'
import { fetch_tenant, fetch_tenants, type TenantRow } from '../../api/tenancy'
import { fetch_users, type UserJson } from '../../api/users'
import { EmailList, PhoneList } from '../../components/contacts'
import { nameColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { Markdown } from '../../components/markdown'
import { t } from '../../i18n'
import { employeeSalutationLabel } from '../../i18n/labels'
import { createRecord, createRows, createRowsFor } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { can, sessionTenantId } from '../../lib/session'
import { EmployeeStatus } from './list'

/**
 * /employees/:id — employee detail: tenant breadcrumb, header with
 * description, the contact details and, for user managers, the employee's
 * conex account.
 */
export function EmployeeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [employee] = createRecord(id, fetch_employee, setError)
	/** Tenant the page is shown under: the user's own when scoped, else the primary one. */
	const tenantId = (): number | undefined => {
		const ids = employee()?.tenant_ids
		const own = sessionTenantId()
		return own !== null && ids?.includes(own) ? own : ids?.[0]
	}
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const [tenants] = createRows(fetch_tenants, setError)
	/** Tenants of the employee the user can see, in membership order. */
	const memberTenants = (): TenantRow[] =>
		(employee()?.tenant_ids ?? []).flatMap((tenantKey) => {
			const row = tenants()?.find((r) => r.id === tenantKey)
			return row ? [row] : []
		})
	const [accounts] = createRowsFor(
		() => can('users.manage') && props.id,
		(key: number) => fetch_users({ employee: key }),
		setError,
	)
	const account = (): UserJson | undefined => accounts()?.[0]
	const scopeName = (scope: number | null): string =>
		scope === null
			? t('common.allTenants')
			: (tenants()?.find((row) => row.id === scope)?.name ?? String(scope))
	const [devices] = createRowsFor(
		id,
		(key: number) => fetch_devices({ employee: [key] }),
		setError,
	)

	const tenantCrumbs = (): Crumb[] => {
		const row = tenant()
		return row ? [{ label: row.name, href: `/tenants/${row.id}` }] : []
	}

	const handleDelete = useDetailDelete({
		noun: 'noun.employee',
		name: () => employee()?.name,
		id: props.id,
		remove: delete_employee,
		setError,
		listRoute: '/employees',
	})

	return (
		<div>
			<DetailShell
				name={employee()?.name}
				crumbs={tenantCrumbs()}
				record={employee}
				loadingText={t('employee.loadingOne')}
				emptyText={t('employee.notFound')}
			>
				<DetailHeader
					name={employee()?.name}
					editHref={`/employees/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={employee()?.description} />

				<DetailCard label={t('employee.details')}>
					<dt>{t('employee.tenants')}</dt>
					<dd>
						<Show when={memberTenants().length > 0} fallback="—">
							<For each={memberTenants()}>
								{(row: TenantRow, index: () => number): JSX.Element => (
									<>
										{index() > 0 ? ', ' : ''}
										<a href={`/tenants/${row.id}`}>{row.name}</a>
									</>
								)}
							</For>
						</Show>
					</dd>
					<dt>{t('employee.salutation')}</dt>
					<dd>
						{employee()?.salutation
							? employeeSalutationLabel(employee()?.salutation ?? '')
							: '—'}
					</dd>
					<dt>{t('employee.title')}</dt>
					<dd>{employee()?.title || '—'}</dd>
					<dt>{t('employee.emails')}</dt>
					<dd>
						<EmailList emails={employee()?.emails ?? []} login={employee()?.login} />
					</dd>
					<dt>{t('employee.phones')}</dt>
					<dd>
						<PhoneList
							phones={employee()?.phones ?? []}
							mainNumber={primaryPhone(tenant()?.phones ?? [], 'phone')}
						/>
					</dd>
					<dt>{t('common.status')}</dt>
					<dd>
						<EmployeeStatus active={employee()?.active ?? 1} />
					</dd>
					<Show when={can('users.manage')}>
						<dt>{account() ? t('employee.loginRole') : t('employee.account')}</dt>
						<dd>
							<Show
								when={account()}
								fallback={
									<Show when={!accounts.loading}>
										<Show
											when={(employee()?.emails.length ?? 0) > 0}
											fallback={t('employee.noAccountNoMail')}
										>
											{t('employee.noAccount')}{' '}
											<a href={`/users/add?employee=${props.id}`}>
												{t('employee.createAccount')}
											</a>
										</Show>
									</Show>
								}
							>
								{(row: () => UserJson) => (
									<>
										<a href={`/users/${row().id}/edit`}>{row().role_name}</a>
										{` (${scopeName(row().tenant_id)})`}
										<Show when={!row().active}> ({t('user.inactive')})</Show>
									</>
								)}
							</Show>
						</dd>
					</Show>
					<dt>{t('common.comments')}</dt>
					<dd>
						<Markdown text={employee()?.comments} />
					</dd>
				</DetailCard>
			</DetailShell>
			<RelatedSection
				id="employee-devices"
				title={t('employee.assignedDevices')}
				noun="noun.device"
				rows={devices}
				emptyText={t('employee.noDevices')}
				viewAllHref={`/devices?employee=${props.id}`}
				columns={[
					nameColumn<DeviceRow>(t('common.name'), '/devices'),
					{
						key: 'device_id',
						label: t('device.deviceId'),
						getValue: (device: DeviceRow): string => device.device_id ?? '—',
					},
				]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
