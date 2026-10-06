import type { ExternalTicketJson } from 'shared/src/types'
import { createSignal, type JSX, Match, Show, Switch } from 'solid-js'
import { fetch_tickets } from '../../api/integrations'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { t } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { createRecord } from '../../lib/resource'
import { can, isScoped } from '../../lib/session'
import { contextTenantId } from '../../lib/tenant_context'
import { formatTime } from '../../lib/time'
import { TICKET_PROVIDER } from '../tickets/add'

/**
 * Dashboard card with the open external tickets of one tenant
 * (`tickets.create`): the user's own tenant for scoped users, else the
 * single tenant selected as context. The server caches the list for up to
 * 30 minutes, so each dashboard load refreshes it at most that often.
 */
export function TicketWidget(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const tenant = (): { tenant?: number } | null => {
		if (isScoped()) {
			return {}
		}
		const id = contextTenantId()
		return id === null ? null : { tenant: id }
	}
	const [list] = createRecord(
		() => (can('tickets.create') ? tenant() : null),
		(s) => fetch_tickets(TICKET_PROVIDER, s.tenant),
		setError,
	)

	const columns: DataTableColumn<ExternalTicketJson>[] = [
		{
			key: 'id',
			label: '#',
			getValue: (ticket: ExternalTicketJson): number => ticket.id,
		},
		{
			key: 'title',
			label: t('ticket.title'),
			getValue: (ticket: ExternalTicketJson): string => ticket.title,
		},
		{
			key: 'status',
			label: t('ticket.status'),
			getValue: (ticket: ExternalTicketJson): string => ticket.status ?? '—',
		},
		{
			key: 'modified',
			label: t('ticket.modified'),
			getValue: (ticket: ExternalTicketJson): string => {
				const time = ticket.modified_at ?? ticket.created_at
				return time === null ? '—' : formatTime(time)
			},
		},
	]

	return (
		<Show when={can('tickets.create')}>
			<section class="card dashboard-widget" aria-labelledby="dashboard-tickets">
				<h3 id="dashboard-tickets">{t('ticket.openTickets')}</h3>
				<Switch
					fallback={
						<>
							<Show when={list()?.fetched_at}>
								{(time: () => number) => (
									<p class="text-muted">
										{t('ticket.fetchedAt', { time: formatTime(time()) })}
									</p>
								)}
							</Show>
							<DataTable
								rows={() => list()?.tickets ?? []}
								getRowId={(ticket: ExternalTicketJson): number => ticket.id}
								columns={columns}
								loading={() => list.loading}
								loadingContent={<Loading message={t('ticket.loading')} />}
								emptyContent={<Empty message={t('ticket.noOpenTickets')} />}
							/>
						</>
					}
				>
					<Match when={tenant() === null}>
						<Empty message={t('ticket.pickTenantContext')} />
					</Match>
					<Match when={list()?.linked === false}>
						<Empty
							message={t('ticket.notLinked', {
								provider: providerLabel(TICKET_PROVIDER),
							})}
						/>
					</Match>
				</Switch>
				<InlineError message={error()} />
			</section>
		</Show>
	)
}
