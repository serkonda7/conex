import { Result } from 'better-result'
import { createMemo, createSignal, type JSX, Show } from 'solid-js'
import { fetch_devices } from '../../api/devices'
import { create_ticket, type IntegrationProvider } from '../../api/integrations'
import { FormPage, row_options, SelectField, TextAreaField, TextField } from '../../components/form'
import { t, tp } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { useFormState } from '../../lib/form'
import { createRowsFor } from '../../lib/resource'
import { parseId, queryParam, useOpenerPath } from '../../lib/router'
import { contextTenantRows } from '../../lib/tenant_context'

/** Ticket system; TANSS is the only one so far. */
export const TICKET_PROVIDER: IntegrationProvider = 'tanss'

/**
 * /tickets/add?tenant=&device= — new external ticket (`tickets.create`):
 * tenant, optional device of that tenant, title and description. The query
 * preselects tenant and device. The server rejects tenants without a
 * company link. On success the ticket number is shown and the form clears
 * for the next ticket.
 */
export function TicketAddPage(): JSX.Element {
	const form = useFormState()
	const openerPath = useOpenerPath()
	const [tenantId, setTenantId] = createSignal(queryParam('tenant'))
	const [deviceId, setDeviceId] = createSignal(queryParam('device'))
	const [title, setTitle] = createSignal('')
	const [content, setContent] = createSignal('')
	const [createdId, setCreatedId] = createSignal<number | null>(null)
	const [devices] = createRowsFor(
		() => parseId(tenantId()),
		(tenant: number) => fetch_devices({ tenant }),
		form.setError,
	)
	const tenantOptions = createMemo(() => row_options(contextTenantRows()))
	const deviceOptions = createMemo(() => row_options(devices() ?? []))

	function handleTenantChange(value: string): void {
		setTenantId(value)
		setDeviceId('')
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const tenant = parseId(tenantId())
		if (tenant === null) {
			form.setError(t('ticket.tenantRequired'))
			return
		}
		if (!title().trim()) {
			form.setError(t('ticket.titleRequired'))
			return
		}
		const device = parseId(deviceId())
		form.setError(null)
		setCreatedId(null)
		form.setSaving(true)
		const res = await create_ticket(TICKET_PROVIDER, {
			tenant_id: tenant,
			...(device !== null ? { device_id: device } : {}),
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

	return (
		<FormPage
			form={form}
			title={t('ticket.createTitle', { provider: providerLabel(TICKET_PROVIDER) })}
			cancelTo={openerPath() ?? '/dashboard'}
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
			<SelectField
				id="ticket-tenant"
				label={tp('entity.tenant', 1)}
				value={tenantId()}
				onChange={handleTenantChange}
				options={tenantOptions()}
				emptyLabel={t('ticket.pickTenant')}
				required
			/>
			<SelectField
				id="ticket-device"
				label={tp('entity.device', 1)}
				value={deviceId()}
				onChange={setDeviceId}
				options={deviceOptions()}
				emptyLabel={t('ticket.noDevice')}
				disabled={parseId(tenantId()) === null}
			/>
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
		</FormPage>
	)
}
