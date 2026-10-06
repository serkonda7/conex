import type { EmployeeEmail, EmployeePhone } from 'shared/src/types'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { delete_employee, fetch_employee } from '../../api/employees'
import { fetch_tenant } from '../../api/tenancy'
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
import { contactScopeLabel, employeeSalutationLabel, phoneTypeLabel } from '../../i18n/labels'
import { createRecord } from '../../lib/resource'
import { EmployeeIntegrationCards } from '../integrations/cards'
import { EmailLink, EmployeeStatus } from './list'

/** Mail addresses, one per line with their scope; the first is marked primary. */
function EmailList(props: { emails: EmployeeEmail[] }): JSX.Element {
	return (
		<Show when={props.emails.length > 0} fallback="—">
			<ul class="contact-list">
				<For each={props.emails}>
					{(e: EmployeeEmail, index: () => number): JSX.Element => (
						<li>
							<EmailLink email={e.address} />{' '}
							<span class="text-muted">{contactScopeLabel(e.scope)}</span>
							<Show when={index() === 0 && props.emails.length > 1}>
								{' '}
								<span class="badge">{t('employee.primary')}</span>
							</Show>
						</li>
					)}
				</For>
			</ul>
		</Show>
	)
}

/** Phone numbers, one per line with their kind and scope. */
function PhoneList(props: { phones: EmployeePhone[] }): JSX.Element {
	return (
		<Show when={props.phones.length > 0} fallback="—">
			<ul class="contact-list">
				<For each={props.phones}>
					{(p: EmployeePhone): JSX.Element => (
						<li>
							<a href={`tel:${p.number.replace(/[^\d+]/g, '')}`}>{p.number}</a>{' '}
							<span class="text-muted">
								{phoneTypeLabel(p.type)} · {contactScopeLabel(p.scope)}
							</span>
						</li>
					)}
				</For>
			</ul>
		</Show>
	)
}

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
