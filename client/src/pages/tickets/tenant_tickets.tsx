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

/** Tickets listed before "Show all". */
const PREVIEW_ROWS = 5

/**
 * Card with the open external tickets of a tenant on its detail page
 * (`tickets.create`); the first few rows until "Show all".
 * The server caches the list for up to 30 minutes, so each page load
 * refreshes it at most that often.
 */
export function TenantTickets(props: { tenantId: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [showAll, setShowAll] = createSignal(false)
	const [list] = createRecord(
		() => (can('tickets.create') ? props.tenantId : null),
		(tenant: number) => fetch_tickets(TICKET_PROVIDER, tenant),
		setError,
	)

	const columns: DataTableColumn<ExternalTicketJson>[] = [
		{
			key: 'id',
			label: '#',
			getValue: (ticket: ExternalTicketJson): JSX.Element => {
				const base = list()?.base_url
				return base ? (
					<a
						href={`${base}/index.php?section=bug&sub=view&bugID=${ticket.id}`}
						target="_blank"
						rel="noopener noreferrer"
					>
						{ticket.id}
					</a>
				) : (
					<span>{ticket.id}</span>
				)
			},
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

	const tickets = (): ExternalTicketJson[] => list()?.tickets ?? []
	const shown = (): ExternalTicketJson[] =>
		showAll() ? tickets() : tickets().slice(0, PREVIEW_ROWS)

	return (
		<Show when={can('tickets.create')}>
			<section class="card" aria-labelledby="tenant-tickets">
				<div class="card-header">
					<h3 id="tenant-tickets">
						{t('ticket.openTickets')} <span class="badge">{tickets().length}</span>
					</h3>
					<Show when={list()?.fetched_at}>
						{(time: () => number) => (
							<span class="text-muted">
								{t('ticket.fetchedAt', { time: formatTime(time()) })}
							</span>
						)}
					</Show>
				</div>
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
					<DataTable
						rows={shown}
						getRowId={(ticket: ExternalTicketJson): number => ticket.id}
						columns={columns}
						loading={() => list.loading}
						loadingContent={<Loading message={t('ticket.loading')} />}
						emptyContent={<Empty message={t('ticket.noOpenTickets')} />}
					/>
					<Show when={!showAll() && tickets().length > PREVIEW_ROWS}>
						<button type="button" class="link-btn" onClick={() => setShowAll(true)}>
							{t('common.showAll', { count: tickets().length })}
						</button>
					</Show>
				</Show>
				<InlineError message={error()} />
			</section>
		</Show>
	)
}
