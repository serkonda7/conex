import { Result } from 'better-result'
import { createEffect, createMemo, createSignal, type JSX, on, Show } from 'solid-js'
import { fetch_devices } from '../../api/devices'
import { fetch_all_employees } from '../../api/employees'
import { create_ticket, type IntegrationProvider } from '../../api/integrations'
import {
	FormPage,
	FormSection,
	row_options,
	SelectField,
	TextAreaField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { useFormState } from '../../lib/form'
import { createRowsFor } from '../../lib/resource'
import { parseId, queryParam, useOpenerPath } from '../../lib/router'
import { isScoped, sessionTenantId } from '../../lib/session'
import { contextTenantId, contextTenantRows, homePath } from '../../lib/tenant_context'

/** Ticket system; TANSS is the only one so far. */
export const TICKET_PROVIDER: IntegrationProvider = 'tanss'

/**
 * /tickets/add?device=&employee= — new external ticket (`tickets.create`)
 * for the tenant selected in the top bar (scoped users: their own): optional
 * device and employee of that tenant, title and description. The query
 * preselects device and employee. The server rejects tenants without a
 * company link. On success the ticket
 * number is shown and the form clears for the next ticket.
 */
export function TicketAddPage(): JSX.Element {
	const form = useFormState()
	const openerPath = useOpenerPath()
	const [deviceId, setDeviceId] = createSignal(queryParam('device'))
	const [employeeId, setEmployeeId] = createSignal(queryParam('employee'))
	const [title, setTitle] = createSignal('')
	const [content, setContent] = createSignal('')
	const [createdId, setCreatedId] = createSignal<number | null>(null)
	const tenantId = createMemo((): number | null =>
		isScoped() ? sessionTenantId() : contextTenantId(),
	)
	const tenantName = (): string | undefined =>
		contextTenantRows().find((row) => row.id === tenantId())?.name
	const [devices] = createRowsFor(
		tenantId,
		(tenant: number) => fetch_devices({ tenant }),
		form.setError,
	)
	const [employees] = createRowsFor(
		tenantId,
		(tenant: number) => fetch_all_employees({ tenant }),
		form.setError,
	)
	const deviceOptions = createMemo(() => row_options(devices() ?? []))
	const employeeOptions = createMemo(() => row_options(employees() ?? []))

	// Device and employee belong to one tenant; a new context drops them.
	createEffect(
		on(
			tenantId,
			() => {
				setDeviceId('')
				setEmployeeId('')
			},
			{ defer: true },
		),
	)

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const tenant = tenantId()
		if (tenant === null) {
			form.setError(t('ticket.tenantRequired'))
			return
		}
		if (!title().trim()) {
			form.setError(t('ticket.titleRequired'))
			return
		}
		const device = parseId(deviceId())
		const employee = parseId(employeeId())
		form.setError(null)
		setCreatedId(null)
		form.setSaving(true)
		const res = await create_ticket(TICKET_PROVIDER, {
			tenant_id: tenant,
			...(device !== null ? { device_id: device } : {}),
			...(employee !== null ? { employee_id: employee } : {}),
			title: title(),
			content: content(),
		})
		form.setSaving(false)
		if (Result.isError(res)) {
			form.setError(res.error.message)
			return
		}
		setCreatedId(res.value.id)
		setTitle('')
		setContent('')
	}

	const pageTitle = (): string => {
		const tenant = tenantName()
		return tenant === undefined
			? t('ticket.createTitle')
			: t('ticket.createTitleFor', { tenant })
	}

	return (
		<FormPage
			form={form}
			title={pageTitle()}
			cancelTo={openerPath() ?? homePath()}
			singleton
			onSubmit={handleSubmit}
		>
			<Show when={createdId()}>
				{(id: () => number) => (
					<p class="text-success" role="status">
						{t('ticket.created', {
							provider: providerLabel(TICKET_PROVIDER),
							id: id(),
						})}
					</p>
				)}
			</Show>
			<FormSection title={t('ticket.assignment')}>
				<SelectField
					id="ticket-device"
					label={tp('entity.device', 1)}
					value={deviceId()}
					onChange={setDeviceId}
					options={deviceOptions()}
					emptyLabel={t('common.selectPlaceholder')}
					disabled={tenantId() === null}
				/>
				<SelectField
					id="ticket-employee"
					label={tp('entity.employee', 1)}
					value={employeeId()}
					onChange={setEmployeeId}
					options={employeeOptions()}
					emptyLabel={t('common.selectPlaceholder')}
					disabled={tenantId() === null || employees.loading}
				/>
			</FormSection>
			<FormSection title={t('ticket.details')}>
				<TextField
					id="ticket-title"
					label={t('ticket.title')}
					value={title()}
					onInput={setTitle}
					maxLength={200}
					required
					autofocus
				/>
				<TextAreaField
					id="ticket-content"
					label={t('ticket.content')}
					value={content()}
					onInput={setContent}
					rows={8}
					maxLength={10000}
				/>
			</FormSection>
		</FormPage>
	)
}
