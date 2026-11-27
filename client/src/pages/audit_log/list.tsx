import type {
	AuditDetail,
	AuditDeviceDetail,
	AuditEvent,
	AuditRoleDetail,
	AuditUserDetail,
	Permission,
} from 'shared/src/schemas'
import { createSignal, type JSX, Show } from 'solid-js'
import { type AuditLogEntryJson, type AuditLogSort, fetch_audit_log } from '../../api/audit_log'
import { type DataTableColumn, FilterTable } from '../../components/data_table'
import { Empty, InlineError } from '../../components/feedback'
import { emptyListText, ListLoading, useListFilters, useSort } from '../../components/list_page'
import { t, tp } from '../../i18n'
import {
	auditEventLabel,
	auditEventOptions,
	compareFieldLabel,
	permissionLabel,
	providerLabel,
} from '../../i18n/labels'
import { usePagedList } from '../../lib/paged_list'
import { formatRelative, formatTime } from '../../lib/time'
import { shortUserAgent } from '../../lib/user_agent'

const AUDIT_EVENT_BADGE: Record<AuditEvent, string> = {
	'login.success': 'badge-active',
	'login.failure': 'badge-decommissioned',
	'password.change': 'badge-planned',
	'password.reset': 'badge-planned',
	'user.role_change': 'badge-planned',
	'role.create': 'badge-planned',
	'role.update': 'badge-planned',
	'role.delete': 'badge-decommissioned',
	'integration.device_create': 'badge-planned',
	'integration.device_update': 'badge-planned',
}

/** Device a `integration.*` event wrote, with what changed externally. */
function DeviceDetail(props: { detail: AuditDeviceDetail }): JSX.Element {
	const d = (): AuditDeviceDetail => props.detail
	const value = (v: string | null | undefined): string => v || t('audit.emptyValue')
	return (
		<span>
			<a href={`/devices/${d().device_id}`}>{d().device_name}</a>{' '}
			<span class="text-muted">
				{d().field
					? t('audit.deviceUpdated', {
							field: compareFieldLabel(d().field ?? ''),
							provider: providerLabel(d().provider),
							from: value(d().from),
							to: value(d().to),
						})
					: t('audit.deviceCreated', { provider: providerLabel(d().provider) })}
			</span>
		</span>
	)
}

/** Account a reset or role change hit, with the role it moved between. */
function UserDetail(props: { detail: AuditUserDetail }): JSX.Element {
	const d = (): AuditUserDetail => props.detail
	return (
		<span>
			{t('audit.targetUser', { username: d().target_username })}
			<Show when={d().to_role}>
				{(to: () => string): JSX.Element => (
					<>
						{' '}
						<span class="text-muted">
							{d().from_role
								? t('audit.roleChanged', { from: d().from_role ?? '', to: to() })
								: t('audit.roleAssigned', { role: to() })}
						</span>
					</>
				)}
			</Show>
		</span>
	)
}

/** Role a `role.*` event changed: its rename and permissions gained or lost. */
function RoleDetail(props: { detail: AuditRoleDetail }): JSX.Element {
	const d = (): AuditRoleDetail => props.detail
	const list = (permissions: Permission[]): string => permissions.map(permissionLabel).join(', ')
	const changes = (): string[] => [
		...(d().renamed_from ? [t('audit.renamedFrom', { name: d().renamed_from ?? '' })] : []),
		...(d().added?.length
			? [t('audit.permissionsAdded', { permissions: list(d().added ?? []) })]
			: []),
		...(d().removed?.length
			? [t('audit.permissionsRemoved', { permissions: list(d().removed ?? []) })]
			: []),
	]
	return (
		<span>
			{d().role_name} <span class="text-muted">{changes().join('; ')}</span>
		</span>
	)
}

/** Event-specific context: the account hit, the role changed, or the device written. */
function AuditDetailCell(props: { detail: AuditDetail }): JSX.Element {
	const detail = props.detail
	if ('target_username' in detail) {
		return <UserDetail detail={detail} />
	}
	return 'role_name' in detail ? <RoleDetail detail={detail} /> : <DeviceDetail detail={detail} />
}

/**
 * /audit-log — admin-only, read-only list of login attempts, password
 * changes, role assignments and role edits, and devices written to external
 * systems, with their source address. Sortable by every column, newest first
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
			key: 'detail',
			label: t('audit.detail'),
			getValue: (e: AuditLogEntryJson): JSX.Element => (
				<Show when={e.detail}>
					{(d: () => AuditDetail): JSX.Element => <AuditDetailCell detail={d()} />}
				</Show>
			),
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
