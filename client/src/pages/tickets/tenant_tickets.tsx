import type { ExternalTicketJson } from 'shared/src/types'
import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_tickets } from '../../api/integrations'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { t } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { createRecord } from '../../lib/resource'
import { can } from '../../lib/session'
import { formatTime } from '../../lib/time'
import { TICKET_PROVIDER } from './add'

/**
 * Open external tickets of a tenant on its detail page (`tickets.create`).
 * The server caches the list for up to 30 minutes, so each page load
 * refreshes it at most that often.
 */
export function TenantTickets(props: { tenantId: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [list] = createRecord(
		() => (can('tickets.create') ? props.tenantId : null),
		(tenant: number) => fetch_tickets(TICKET_PROVIDER, tenant),
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
			<h3 id="tenant-tickets">
				{t('ticket.openTickets')} <span class="badge">{list()?.tickets.length ?? 0}</span>
			</h3>
			<Show
				when={list()?.linked !== false}
				fallback={
					<Empty
						message={t('ticket.notLinked', {
							provider: providerLabel(TICKET_PROVIDER),
						})}
					/>
				}
			>
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
			</Show>
			<InlineError message={error()} />
		</Show>
	)
}
