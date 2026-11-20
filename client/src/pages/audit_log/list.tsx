import type { AuditEvent } from 'shared/src/schemas'
import { createSignal, type JSX, Show } from 'solid-js'
import { type AuditLogEntryJson, type AuditLogSort, fetch_audit_log } from '../../api/audit_log'
import { type DataTableColumn, FilterTable } from '../../components/data_table'
import { Empty, InlineError } from '../../components/feedback'
import { emptyListText, ListLoading, useListFilters, useSort } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { auditEventLabel, auditEventOptions } from '../../i18n/labels'
import { usePagedList } from '../../lib/paged_list'
import { formatRelative, formatTime } from '../../lib/time'
import { shortUserAgent } from '../../lib/user_agent'

const AUDIT_EVENT_BADGE: Record<AuditEvent, string> = {
	'login.success': 'badge-active',
	'login.failure': 'badge-decommissioned',
	'password.change': 'badge-planned',
	'password.reset': 'badge-planned',
}

/**
 * /audit-log — admin-only, read-only list of login attempts and password
 * changes with their source address. Sortable by every column, newest first
 * by default; searchable by username or IP and filterable by event.
 */
export function AuditLogPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [event, setEvent] = createSignal<AuditEvent[]>([])
	const filters = useListFilters<AuditLogEntryJson>({
		search,
		setSearch,
		filters: () => [
			{
				key: 'event',
				label: t('audit.event'),
				options: auditEventOptions(),
				value: event,
				onChange: (value: string[]): void => {
					setEvent(value as AuditEvent[])
				},
			},
		],
	})

	const { sort, order, handleSort, clearSort } = useSort<AuditLogSort>('created_at', 'desc')

	const entries = usePagedList({
		query: () => ({
			search: search(),
			event: event().length > 0 ? event() : undefined,
			sort: sort(),
			order: order(),
		}),
		fetch: fetch_audit_log,
		setError,
	})

	const columns: DataTableColumn<AuditLogEntryJson>[] = [
		{
			key: 'created_at',
			label: t('audit.time'),
			class: 'cell-nowrap',
			sortable: true,
			getValue: (e: AuditLogEntryJson): JSX.Element => (
				<span title={formatTime(e.created_at)}>{formatRelative(e.created_at)}</span>
			),
		},
		{
			key: 'event',
			label: t('audit.event'),
			sortable: true,
			getValue: (e: AuditLogEntryJson): JSX.Element => (
				<span class={`badge ${AUDIT_EVENT_BADGE[e.event]}`}>
					{auditEventLabel(e.event)}
				</span>
			),
		},
		{
			key: 'username',
			label: t('auth.username'),
			sortable: true,
			getValue: (e: AuditLogEntryJson): string => e.username,
		},
		{
			key: 'target_username',
			label: t('audit.target'),
			sortable: true,
			getValue: (e: AuditLogEntryJson): string => e.target_username ?? '',
		},
		{
			key: 'ip',
			label: t('audit.sourceIp'),
			sortable: true,
			// A forwarded address is only a client-supplied hint, so the socket
			// peer stays visible next to it.
			getValue: (e: AuditLogEntryJson): JSX.Element => (
				<Show when={e.forwarded_for} fallback={<span>{e.ip}</span>}>
					{(fwd: () => string): JSX.Element => (
						<span>
							{fwd()}{' '}
							<span class="text-muted">({t('audit.viaPeer', { ip: e.ip })})</span>
						</span>
					)}
				</Show>
			),
		},
		{
			key: 'user_agent',
			label: t('audit.userAgent'),
			sortable: true,
			getValue: (e: AuditLogEntryJson): JSX.Element => (
				<span class="text-muted" title={e.user_agent ?? ''}>
					{e.user_agent ? shortUserAgent(e.user_agent) : ''}
				</span>
			),
		},
	]

	const emptyText = (): string =>
		emptyListText({
			noun: tp('noun.auditEntry', 2),
			search: search(),
			filtered: event().length > 0,
			empty: t('audit.empty'),
		})

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.auditLog', 1)}</h2>
			</div>

			<FilterTable
				rows={entries.rows}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				savedFiltersKey="audit-log"
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: tp('noun.auditEntry', 2) })}
				getRowId={(e: AuditLogEntryJson): number => e.id}
				columns={columns}
				sortKey={sort}
				sortDirection={order}
				onSort={handleSort}
				onSortClear={clearSort}
				pagination={entries.pagination}
				onPaginationChange={entries.onPaginationChange}
				loading={() => entries.page.loading}
				loadingContent={
					<ListLoading rows={entries.rows()} noun={tp('noun.auditEntry', 2)} />
				}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<InlineError message={error()} />
		</div>
	)
}
