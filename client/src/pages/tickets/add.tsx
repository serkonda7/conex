import { Result } from 'better-result'
import { priorityLabel } from 'shared/src/priority'
import { createEffect, createMemo, createSignal, type JSX, on, Show } from 'solid-js'
import { fetch_devices } from '../../api/devices'
import { fetch_all_employees } from '../../api/employees'
import { create_ticket, type IntegrationProvider } from '../../api/integrations'
import { fetch_priorities } from '../../api/service_catalog'
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
import { createRows, createRowsFor } from '../../lib/resource'
import { parseId, queryParam, useOpenerPath } from '../../lib/router'
import { contextTenantRows, homePath, newObjectTenantId } from '../../lib/tenant_context'

/** Ticket system; TANSS is the only one so far. */
export const TICKET_PROVIDER: IntegrationProvider = 'tanss'

/**
 * /tickets/add?device=&employee= — new external ticket (`tickets.create`)
 * for the tenant selected in the top bar (scoped users: their own): title,
 * description, priority (preset to the lowest) and the optional device and
 * employee of that tenant. The query preselects device and employee. The server rejects tenants without a
 * company link. On success the ticket
 * number is shown and the form clears for the next ticket.
 */
export function TicketAddPage(): JSX.Element {
	const form = useFormState()
	const openerPath = useOpenerPath()
	const [deviceId, setDeviceId] = createSignal(queryParam('device'))
	const [employeeId, setEmployeeId] = createSignal(queryParam('employee'))
	const [priorityId, setPriorityId] = createSignal('')
	const [title, setTitle] = createSignal('')
	const [content, setContent] = createSignal('')
	const [createdId, setCreatedId] = createSignal<number | null>(null)
	const tenantId = createMemo(newObjectTenantId)
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
	const [priorities] = createRows(() => fetch_priorities({ limit: 200 }), form.setError)
	const deviceOptions = createMemo(() => row_options(devices() ?? []))
	const employeeOptions = createMemo(() => row_options(employees() ?? []))
	const priorityOptions = createMemo(() =>
		(priorities() ?? []).map((row) => ({ value: row.id, label: priorityLabel(row) })),
	)
	// Sorted by rank, most urgent first.
	const lowestPriority = (): string => String(priorities()?.at(-1)?.id ?? '')

	createEffect(
		on(priorities, () => {
			if (priorityId() === '') {
				setPriorityId(lowestPriority())
			}
		}),
	)

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
		// The form blocks submitting without a tenant.
		if (tenant === null) {
			return
		}
		if (!title().trim()) {
			form.setError(t('ticket.titleRequired'))
			return
		}
		const device = parseId(deviceId())
		const employee = parseId(employeeId())
		const priority = parseId(priorityId())
		form.setError(null)
		setCreatedId(null)
		form.setSaving(true)
		const res = await create_ticket(TICKET_PROVIDER, {
			tenant_id: tenant,
			...(device !== null ? { device_id: device } : {}),
			...(employee !== null ? { employee_id: employee } : {}),
			...(priority !== null ? { priority_id: priority } : {}),
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
		setPriorityId(lowestPriority())
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
			tenant="required"
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
				<SelectField
					id="ticket-priority"
					label={tp('entity.priority', 1)}
					value={priorityId()}
					onChange={setPriorityId}
					options={priorityOptions()}
					disabled={priorities.loading || priorityOptions().length === 0}
				/>
				<TextAreaField
					id="ticket-content"
					label={t('common.description')}
					value={content()}
					onInput={setContent}
					rows={8}
					maxLength={10000}
				/>
			</FormSection>
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
		</FormPage>
	)
}
