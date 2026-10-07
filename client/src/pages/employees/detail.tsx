import { primaryPhone } from 'shared/src/schemas'
import { createSignal, type JSX } from 'solid-js'
import { delete_employee, fetch_employee } from '../../api/employees'
import { fetch_tenant } from '../../api/tenancy'
import { EmailList, PhoneList } from '../../components/contacts'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t } from '../../i18n'
import { employeeSalutationLabel } from '../../i18n/labels'
import { createRecord } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { EmployeeIntegrationCards } from '../integrations/cards'
import { EmployeeStatus } from './list'

/**
 * /employees/:id — employee detail: tenant breadcrumb, header with
 * description, the contact details and the integration cards.
 */
export function EmployeeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [employee] = createRecord(id, fetch_employee, setError)
	const tenantId = (): number | undefined => employee()?.tenant_id
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)

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
						<EmailList emails={employee()?.emails ?? []} />
					</dd>
					<dt>{t('employee.phones')}</dt>
					<dd>
						<PhoneList
							phones={employee()?.phones ?? []}
							mainNumber={primaryPhone(tenant()?.phones ?? [], 'phone')}
						/>
					</dd>
					<dt>{t('employee.status')}</dt>
					<dd>
						<EmployeeStatus active={employee()?.active ?? 1} />
					</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{employee()?.comments || '—'}</dd>
				</DetailCard>
				<EmployeeIntegrationCards employeeId={props.id} />
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}
