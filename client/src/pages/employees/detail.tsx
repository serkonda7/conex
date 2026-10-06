import { createSignal, type JSX } from 'solid-js'
import { delete_employee, fetch_employee } from '../../api/employees'
import { fetch_tenant } from '../../api/tenancy'
import { EmailList, PhoneList } from '../../components/contacts'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RecordLink,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { employeeSalutationLabel } from '../../i18n/labels'
import { createRecord } from '../../lib/resource'
import { EmployeeIntegrationCards } from '../integrations/cards'
import { EmployeeStatus } from './list'

/**
 * /employees/:id — employee detail: header with description, the contact
 * details and the integration cards.
 */
export function EmployeeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [employee] = createRecord(id, fetch_employee, setError)
	const tenantId = (): number | undefined => employee()?.tenant_id
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)

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
					<dt>{tp('entity.tenant', 1)}</dt>
					<dd>
						<RecordLink id={tenantId()} record={tenant} base="/tenants" />
					</dd>
					<dt>{t('employee.salutation')}</dt>
					<dd>
						{employee()?.salutation
							? employeeSalutationLabel(employee()?.salutation ?? '')
							: '—'}
					</dd>
					<dt>{t('employee.firstName')}</dt>
					<dd>{employee()?.first_name || '—'}</dd>
					<dt>{t('employee.lastName')}</dt>
					<dd>{employee()?.last_name}</dd>
					<dt>{t('employee.title')}</dt>
					<dd>{employee()?.title || '—'}</dd>
					<dt>{t('employee.emails')}</dt>
					<dd>
						<EmailList emails={employee()?.emails ?? []} />
					</dd>
					<dt>{t('employee.phones')}</dt>
					<dd>
						<PhoneList phones={employee()?.phones ?? []} />
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
