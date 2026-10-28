import { IconTicket } from '@tabler/icons-solidjs'
import { type JSX, Show } from 'solid-js'
import { fetch_device } from '../../api/devices'
import { IconLabel } from '../../components/icon_label'
import { t } from '../../i18n'
import { createRecord } from '../../lib/resource'
import { navigate, path, routeSegments } from '../../lib/router'
import { can } from '../../lib/session'
import { contextTenantId } from '../../lib/tenant_context'

/** Id of the device open in the active tab (`/devices/:id`), else null. */
function openDeviceId(): number | null {
	const [section, id, ...rest] = routeSegments(path())
	return section === 'devices' && rest.length === 0 && id !== undefined && /^\d+$/.test(id)
		? Number(id)
		: null
}

/**
 * Top-bar "Ticket" button next to the tenant context (`tickets.create`):
 * opens `/tickets/add` in its own tab, which uses the user's own tenant
 * (scoped users) or the selected tenant context. The device open in the
 * active tab is preselected, along with the employee it is assigned to, when
 * it belongs to that tenant.
 */
export function CreateTicketButton(props: { scopeTenantId: number | null }): JSX.Element {
	const [device] = createRecord(
		() => (can('tickets.create') ? openDeviceId() : null),
		fetch_device,
	)
	const target = (): string => {
		const d = device()
		const query = new URLSearchParams()
		if (d && d.tenant_id === (props.scopeTenantId ?? contextTenantId())) {
			query.set('device', String(d.id))
			if (d.employee_id !== null) {
				query.set('employee', String(d.employee_id))
			}
		}
		const qs = query.toString()
		return qs === '' ? '/tickets/add' : `/tickets/add?${qs}`
	}
	return (
		<Show when={can('tickets.create')}>
			<button
				type="button"
				class="app-topbar-ticket"
				title={t('ticket.create')}
				aria-label={t('ticket.create')}
				onClick={() => navigate(target())}
			>
				<IconLabel icon={IconTicket}>{t('entity.ticket.one')}</IconLabel>
			</button>
		</Show>
	)
}
