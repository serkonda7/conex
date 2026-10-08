import { Result } from 'better-result'
import type { AuditEvent } from 'shared/src/schemas'
import { createResource, createSignal, For, type JSX, Show } from 'solid-js'
import { type AuditLogEntryJson, fetch_audit_log } from '../../api/audit_log'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { ListRangeStatus, ListSearchField, useDebouncedSearch } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { auditEventLabel, auditEventOptions } from '../../i18n/labels'
import { formatTime } from '../../lib/time'

const AUDIT_EVENT_BADGE: Record<AuditEvent, string> = {
	'login.success': 'badge-active',
	'login.failure': 'badge-decommissioned',
	'password.change': 'badge-planned',
	'password.reset': 'badge-planned',
}

/**
 * /audit-log — admin-only, read-only list of login attempts and password
 * changes (newest first) with their source address. Searchable by username
 * or IP and filterable by event.
 */
export function AuditLogPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const [event, setEvent] = createSignal<AuditEvent | ''>('')

	const [entries] = createResource(
		() => ({ search: debouncedSearch(), event: event() }),
		async (q) => {
			setError(null)
			const res = await fetch_audit_log({ search: q.search, event: q.event || undefined })
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)

	const columns: DataTableColumn<AuditLogEntryJson>[] = [
		{
			key: 'time',
			label: t('audit.time'),
			getValue: (e: AuditLogEntryJson): string => formatTime(e.created_at),
		},
		{
			key: 'event',
			label: t('audit.event'),
			getValue: (e: AuditLogEntryJson): JSX.Element => (
				<span class={`badge ${AUDIT_EVENT_BADGE[e.event]}`}>
					{auditEventLabel(e.event)}
				</span>
			),
		},
		{
			key: 'username',
			label: t('auth.username'),
			getValue: (e: AuditLogEntryJson): string => e.username,
		},
		{
			key: 'target',
			label: t('audit.target'),
			getValue: (e: AuditLogEntryJson): string => e.target_username ?? '',
		},
		{
			key: 'ip',
			label: t('audit.sourceIp'),
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
			getValue: (e: AuditLogEntryJson): JSX.Element => (
				<span class="text-muted">{e.user_agent ?? ''}</span>
			),
		},
	]

	const emptyText = (): string =>
		debouncedSearch()
			? t('list.noMatch', { noun: tp('noun.auditEntry', 2), search: debouncedSearch() })
			: event()
				? t('list.noMatchFilters', { noun: tp('noun.auditEntry', 2) })
				: t('audit.empty')

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.auditLog', 1)}</h2>
			</div>

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.auditEntry', 2) })}
					placeholder={t('common.quickSearch')}
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">{t('audit.filterByEvent')}</span>
					<select
						aria-label={t('audit.filterByEvent')}
						value={event()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setEvent(e.currentTarget.value as AuditEvent | '')
						}}
					>
						<option value="">{t('audit.allEvents')}</option>
						<For each={auditEventOptions()}>
							{(o: { value: AuditEvent; label: string }): JSX.Element => (
								<option value={o.value}>{o.label}</option>
							)}
						</For>
					</select>
				</label>
			</div>

			<DataTable
				rows={() => entries()?.items ?? []}
				getRowId={(e: AuditLogEntryJson): number => e.id}
				columns={columns}
				loading={() => entries.loading}
				loadingContent={
					<Loading message={t('list.loading', { noun: tp('noun.auditEntry', 2) })} />
				}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<ListRangeStatus shown={entries()?.items.length ?? 0} total={entries()?.total ?? 0} />

			<InlineError message={error()} />
		</div>
	)
}
