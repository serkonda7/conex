import { IconBan, IconLinkPlus, IconRefresh, IconTicket, IconUnlink } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import {
	EMPLOYEE_PUSH_FIELDS,
	type EmployeePushField,
	EXTERNAL_PUSH_FIELDS,
	type ExternalPushField,
	FINDING_KINDS,
	type FindingKind,
	type IntegrationFinding,
} from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js'
import {
	create_external_device,
	deactivate_external_employee,
	type ExternalTenantListItem,
	fetch_integration,
	fetch_integration_report,
	fetch_link_board,
	type IntegrationJson,
	type IntegrationProvider,
	ignore_external,
	ignore_local,
	import_external_employees,
	type LinkBoard,
	link_external,
	run_sync,
	start_sync,
	unlink_external,
	update_external_device,
	update_external_employee,
	update_integration,
} from '../../api/integrations'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { SelectField } from '../../components/form'
import { type RowMenuAction, useTableColumns } from '../../components/list_page'
import { t, tp } from '../../i18n'
import {
	compareFieldLabel,
	compareValueLabel,
	deviceStatusLabel,
	findingKindLabel,
	providerDescription,
	providerLabel,
} from '../../i18n/labels'
import { createRecord, useAction } from '../../lib/resource'
import { parseId, queryParam, usePageMeta } from '../../lib/router'
import { can, canGlobal, isScoped, sessionTenantId } from '../../lib/session'
import { contextTenantId, tenantContext, tenantContextFilters } from '../../lib/tenant_context'
import { formatTime } from '../../lib/time'
import { type DetailTab, DetailTabs, IntegrationDetailHeader } from './detail_parts'
import { ExternalTenantPicker } from './external_tenant_picker'
import type { IntegrationStatus } from './integration_card'
import { LinkBoardView } from './link_board'
import { ProviderSettings } from './settings'

/** Field of a mismatch that can be written to the external system. */
function pushField(f: IntegrationFinding): ExternalPushField | null {
	return f.kind === 'device_mismatch' &&
		(EXTERNAL_PUSH_FIELDS as readonly string[]).includes(f.field ?? '')
		? (f.field as ExternalPushField)
		: null
}

/** Field of an employee mismatch that can be written to the external system. */
function employeePushField(f: IntegrationFinding): EmployeePushField | null {
	return f.kind === 'employee_mismatch' &&
		f.local !== null &&
		(EMPLOYEE_PUSH_FIELDS as readonly string[]).includes(f.field ?? '')
		? (f.field as EmployeePushField)
		: null
}

function findingKey(f: IntegrationFinding): string {
	return [f.kind, f.tenant_id, f.device_id, f.external_id, f.field, f.local].join('|')
}

/** Field, conex value and external value of a mismatch; matched field of a suggestion. */
function details(f: IntegrationFinding): JSX.Element {
	if (f.field === null) {
		return ''
	}
	if (f.kind === 'device_suggestion' || f.kind === 'employee_suggestion') {
		return t('integration.matchedBy', { field: compareFieldLabel(f.field) })
	}
	if (f.kind === 'priority_tag_missing') {
		return (
			<span class="finding-detail">
				<span class="text-muted">{tp('entity.priority', 1)}</span>
				<span>{f.local}</span>
			</span>
		)
	}
	if (
		f.kind !== 'device_mismatch' &&
		f.kind !== 'employee_mismatch' &&
		f.kind !== 'tenant_customer_number_mismatch'
	) {
		return ''
	}
	const activeLabel = (value: string | null): string =>
		value === 'active' ? t('integration.active') : t('integration.inactive')
	const status = f.field === 'status'
	const local = status
		? f.kind === 'employee_mismatch'
			? activeLabel(f.local)
			: deviceStatusLabel(f.local ?? '')
		: (compareValueLabel(f.field, f.local) ?? '—')
	const remote = status ? activeLabel(f.remote) : (compareValueLabel(f.field, f.remote) ?? '—')
	return (
		<span class="finding-detail">
			<span class="text-muted">{compareFieldLabel(f.field)}</span>
			<span class="text-success">{local}</span>
			<span class="text-danger">{remote}</span>
		</span>
	)
}

/** `?kind=` preselects the finding filter (finding count links); unknown kinds show all. */
function parseKind(raw: string): FindingKind | '' {
	return (FINDING_KINDS as readonly string[]).includes(raw) ? (raw as FindingKind) : ''
}

type View = 'report' | 'tenants' | 'devices' | 'employees' | 'settings'

function parseView(raw: string): View {
	return raw === 'tenants' || raw === 'devices' || raw === 'employees' || raw === 'settings'
		? raw
		: 'report'
}

/** Header state of the provider; `syncing` is a sync started from this page. */
function providerStatus(integration: IntegrationJson, syncing: boolean): IntegrationStatus {
	if (!integration.enabled) {
		return 'disabled'
	}
	if (integration.last_error) {
		return 'error'
	}
	return syncing || integration.last_sync?.state === 'running' ? 'running' : 'connected'
}

/**
 * Link board of tenants, or of the devices or employees of the selected
 * tenant (`tenant`, null: none selected).
 */
function LinkBoardPanel(props: {
	provider: IntegrationProvider
	entity_type: 'tenant' | 'device' | 'employee'
	tenant: number | null
	on_error: (message: string | null) => void
}): JSX.Element {
	const source = createMemo(() =>
		props.entity_type === 'tenant'
			? { entity_type: props.entity_type, tenant: undefined }
			: props.tenant !== null
				? {
						entity_type: props.entity_type,
						tenant: props.tenant,
					}
				: null,
	)
	const [board] = createRecord(
		source,
		(s) => fetch_link_board(props.provider, s.entity_type, s.tenant),
		props.on_error,
	)

	function handleTenantsLinked(tenantIds: number[]): void {
		// Fetch the companies' devices right away (one tenant, or all linked
		// ones after a bulk link). A run already in progress answers 409; the
		// next "Sync now" covers these tenants then.
		void start_sync(props.provider, tenantIds.length === 1 ? tenantIds[0] : undefined)
	}

	const editable = (): boolean =>
		props.entity_type === 'tenant'
			? canGlobal('integrations.manage')
			: can('integrations.manage')

	return (
		<div>
			<Show
				when={source() !== null}
				fallback={<Empty message={t('integration.pickBoardTenant')} />}
			>
				<Show
					when={board()}
					fallback={
						<Show when={board.loading}>
							<Loading message={t('integration.loadingBoard')} />
						</Show>
					}
				>
					{(current: () => LinkBoard): JSX.Element => (
						<>
							<Show
								when={
									current().entity_type === 'tenant' ||
									current().external_tenant !== null
								}
								fallback={
									<Empty
										message={t('integration.boardTenantNotLinked', {
											provider: providerLabel(props.provider),
										})}
									/>
								}
							>
								<LinkBoardView
									provider={props.provider}
									board={current()}
									tenant_id={props.tenant ?? undefined}
									editable={editable()}
									on_error={props.on_error}
									on_linked={
										props.entity_type === 'tenant'
											? handleTenantsLinked
											: undefined
									}
								/>
							</Show>
						</>
					)}
				</Show>
			</Show>
		</div>
	)
}

/**
 * /integrations/:id — detail page of one provider (decision 0006): header with
 * status, Enabled switch and "Sync now", then tabs: the consistency report,
 * link boards (`?view=tenants|devices|employees`) for side-by-side linking, and
 * the settings (`?view=settings`). The report, the device/employee boards and
 * "Sync now" follow the tenant selector; `?tenant=` (from a tenant's integration
 * card) wins until the selector is switched. Rows offer the fitting fix: link,
 * confirm a suggestion, create the device externally, ignore, or unlink.
 */
export function IntegrationDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [kindFilter, setKindFilter] = createSignal<string>(parseKind(queryParam('kind')))
	const [linkingTenant, setLinkingTenant] = createSignal<number | null>(null)
	const [view, setView] = createSignal<View>(parseView(queryParam('view')))
	const [queryTenant, setQueryTenant] = createSignal(parseId(queryParam('tenant')))
	createEffect(on(tenantContext, () => setQueryTenant(null), { defer: true }))
	// Single selected tenant (the user's only one, if so) of the boards and syncs.
	const selectedTenant = (): number | null =>
		queryTenant() ?? sessionTenantId() ?? contextTenantId()
	const views = (): DetailTab<View>[] => [
		{ key: 'report', label: t('integration.viewReport') },
		// The tenant board lists every external company: global users only.
		...(isScoped() ? [] : [{ key: 'tenants' as const, label: t('integration.viewTenants') }]),
		{ key: 'devices', label: t('integration.viewDevices') },
		{ key: 'employees', label: t('integration.viewEmployees') },
		...(can('integrations.manage')
			? [{ key: 'settings' as const, label: t('integration.settings') }]
			: []),
	]

	const [integration, { mutate }] = createRecord(() => props.id, fetch_integration, setError)
	usePageMeta(() => ({
		name: integration() ? providerLabel(integration()?.provider ?? '') : undefined,
	}))

	const source = createMemo(() => {
		const row = integration()
		if (!row) {
			return null
		}
		return {
			provider: row.provider,
			...tenantContextFilters(queryTenant() ?? undefined),
		}
	})

	const [report] = createRecord(source, (s) => fetch_integration_report(s.provider, s), setError)

	const counts = createMemo(() => {
		const out = new Map<FindingKind, number>()
		for (const f of report()?.findings ?? []) {
			out.set(f.kind, (out.get(f.kind) ?? 0) + 1)
		}
		return out
	})

	const rows = createMemo(() => {
		const kind = kindFilter()
		const all = report()?.findings ?? []
		return kind === '' ? all : all.filter((f) => f.kind === kind)
	})

	const action = useAction(setError)
	const sync = useAction(setError)
	const toggle = useAction(setError)

	async function handleToggle(enabled: boolean): Promise<void> {
		const row = integration()
		if (!row) {
			return
		}
		await toggle.run(async () => {
			const res = await update_integration(row.provider, { enabled })
			if (Result.isOk(res)) {
				mutate(res.value)
			}
			return res
		})
	}

	async function run(request: () => Promise<Result<unknown, Error>>): Promise<void> {
		await action.run(request)
	}

	async function handleSync(clean = false): Promise<void> {
		const row = integration()
		if (!row || sync.pending()) {
			return
		}
		if (
			clean &&
			!window.confirm(t('integration.confirmFullSync', { name: providerLabel(row.provider) }))
		) {
			return
		}
		await sync.run(() => run_sync(row.provider, selectedTenant() ?? undefined, clean))
	}

	function selectView(next: View): void {
		setError(null)
		setView(next)
	}

	const menuActions = (): RowMenuAction[] =>
		canGlobal('integrations.manage')
			? [
					{
						label: t('integration.forceFullSync'),
						icon: IconRefresh,
						onSelect: (): void => void handleSync(true),
					},
				]
			: []

	function handleLinkTenant(item: ExternalTenantListItem): void {
		const row = integration()
		const tenant = linkingTenant()
		setLinkingTenant(null)
		if (!row || tenant === null) {
			return
		}
		void run(() => link_external(row.provider, 'tenant', tenant, item.external_id))
	}

	function actions(f: IntegrationFinding): JSX.Element {
		const row = integration()
		if (!row) {
			return null
		}
		const provider = row.provider
		const deactivate: JSX.Element = (
			<button
				type="button"
				class="btn-small"
				disabled={action.pending()}
				onClick={(): void => {
					if (
						f.external_id !== null &&
						window.confirm(
							t('integration.confirmDeactivateEmployee', {
								name: f.external_name ?? f.external_id,
								provider: providerLabel(provider),
							}),
						)
					) {
						void run(() => deactivate_external_employee(provider, f.external_id ?? ''))
					}
				}}
			>
				{t('integration.deactivateEmployee', { provider: providerLabel(provider) })}
			</button>
		)
		const ignoreButton = (request: () => Promise<Result<unknown, Error>>): JSX.Element => (
			<button
				type="button"
				class="icon-btn"
				title={t('integration.ignore')}
				aria-label={t('integration.ignore')}
				onClick={(): void => void run(request)}
			>
				<IconBan size={20} />
			</button>
		)
		const confirmLinkButton = (request: () => Promise<Result<unknown, Error>>): JSX.Element => (
			<button
				type="button"
				class="icon-btn icon-btn-connect"
				title={t('integration.confirmLink')}
				aria-label={t('integration.confirmLink')}
				onClick={(): void => void run(request)}
			>
				<IconLinkPlus size={20} />
			</button>
		)
		const unlink: JSX.Element = (
			<Show when={f.link_id !== null}>
				<button
					type="button"
					class="icon-btn icon-btn-danger"
					title={t('integration.unlink')}
					aria-label={t('integration.unlink')}
					onClick={(): void => void run(() => unlink_external(provider, f.link_id ?? 0))}
				>
					<IconUnlink size={20} />
				</button>
			</Show>
		)
		switch (f.kind) {
			case 'tenant_unlinked':
				return (
					<Show when={canGlobal('integrations.manage')}>
						<button
							type="button"
							class="icon-btn icon-btn-connect"
							title={t('integration.link')}
							aria-label={t('integration.link')}
							onClick={() => setLinkingTenant(f.tenant_id)}
						>
							<IconLinkPlus size={20} />
						</button>
					</Show>
				)
			case 'tenant_missing_in_conex':
				return (
					<Show when={canGlobal('integrations.manage')}>
						{ignoreButton(() =>
							ignore_external(provider, 'tenant', f.external_id ?? ''),
						)}
					</Show>
				)
			case 'tenant_stale':
				return <Show when={canGlobal('integrations.manage')}>{unlink}</Show>
			case 'device_suggestion':
				return (
					<Show when={can('integrations.manage')}>
						{confirmLinkButton(() =>
							link_external(
								provider,
								'device',
								f.device_id ?? 0,
								f.external_id ?? '',
							),
						)}
					</Show>
				)
			case 'device_missing_in_conex':
				return (
					<Show when={can('integrations.manage')}>
						{ignoreButton(() =>
							ignore_external(provider, 'device', f.external_id ?? ''),
						)}
					</Show>
				)
			case 'device_missing_in_external':
				return (
					<Show when={can('integrations.manage')}>
						<button
							type="button"
							class="btn-small"
							onClick={() =>
								void run(() => create_external_device(provider, f.device_id ?? 0))
							}
						>
							{t('integration.createExternal', { provider: providerLabel(provider) })}
						</button>
						{ignoreButton(() => ignore_local(provider, 'device', f.device_id ?? 0))}
					</Show>
				)
			case 'device_stale':
				return <Show when={can('integrations.manage')}>{unlink}</Show>
			case 'device_mismatch': {
				const field = pushField(f)
				return (
					<Show when={can('integrations.manage')}>
						<Show when={f.field === 'tenant'}>{unlink}</Show>
						{field !== null && (
							<button
								type="button"
								class="btn-small"
								onClick={() =>
									void run(() =>
										update_external_device(provider, f.device_id ?? 0, field),
									)
								}
							>
								{t('integration.updateExternal', {
									provider: providerLabel(provider),
								})}
							</button>
						)}
					</Show>
				)
			}
			case 'employee_suggestion':
				return (
					<Show when={can('integrations.manage')}>
						{provider === 'tanss' &&
							f.remote === 'active' &&
							f.external_id !== null &&
							deactivate}
						{confirmLinkButton(() =>
							link_external(
								provider,
								'employee',
								f.employee_id ?? 0,
								f.external_id ?? '',
							),
						)}
					</Show>
				)
			case 'employee_missing_in_conex':
				return (
					<Show when={can('integrations.manage')}>
						{provider === 'tanss' && f.external_id !== null && deactivate}
						<Show when={can('edit') && f.tenant_id !== null}>
							<button
								type="button"
								class="btn-small"
								onClick={() =>
									void run(() =>
										import_external_employees(provider, f.tenant_id ?? 0, [
											f.external_id ?? '',
										]),
									)
								}
							>
								{t('integration.importToConex')}
							</button>
						</Show>
						{ignoreButton(() =>
							ignore_external(provider, 'employee', f.external_id ?? ''),
						)}
					</Show>
				)
			case 'employee_missing_in_external':
				return (
					<Show when={can('integrations.manage')}>
						{ignoreButton(() => ignore_local(provider, 'employee', f.employee_id ?? 0))}
					</Show>
				)
			case 'employee_stale':
				return <Show when={can('integrations.manage')}>{unlink}</Show>
			case 'employee_mismatch': {
				const field = employeePushField(f)
				return (
					<Show when={can('integrations.manage')}>
						<Show when={f.field === 'tenant'}>{unlink}</Show>
						{provider === 'tanss' &&
							f.field === 'status' &&
							f.local === 'inactive' &&
							f.remote === 'active' &&
							f.external_id !== null &&
							deactivate}
						{field !== null && (
							<button
								type="button"
								class="btn-small"
								onClick={() =>
									void run(() =>
										update_external_employee(
											provider,
											f.employee_id ?? 0,
											field,
										),
									)
								}
							>
								{t('integration.updateExternal', {
									provider: providerLabel(provider),
								})}
							</button>
						)}
					</Show>
				)
			}
			default:
				return null
		}
	}

	const columns: DataTableColumn<IntegrationFinding>[] = [
		{
			key: 'kind',
			label: t('integration.finding'),
			getValue: (f: IntegrationFinding): JSX.Element => (
				<span class="badge">{findingKindLabel(f.kind)}</span>
			),
		},
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (f: IntegrationFinding): JSX.Element =>
				f.tenant_id !== null ? (
					<a href={`/tenants/${f.tenant_id}`}>{f.tenant_name}</a>
				) : (
					'—'
				),
		},
		{
			key: 'device',
			label: tp('entity.device', 1),
			getValue: (f: IntegrationFinding): JSX.Element =>
				f.device_id !== null ? (
					<a href={`/devices/${f.device_id}`}>{f.device_name}</a>
				) : (
					'—'
				),
		},
		{
			key: 'employee',
			label: tp('entity.employee', 1),
			getValue: (f: IntegrationFinding): JSX.Element =>
				f.employee_id !== null ? (
					<a href={`/employees/${f.employee_id}`}>{f.employee_name}</a>
				) : (
					'—'
				),
		},
		{
			key: 'external',
			label: providerLabel(integration()?.provider ?? 'tanss'),
			getValue: (f: IntegrationFinding): JSX.Element =>
				f.external_id !== null ? (
					<span>
						{f.external_name ?? '—'} <small>{f.external_id}</small>
					</span>
				) : (
					'—'
				),
		},
		{
			key: 'details',
			label: t('integration.details'),
			getValue: (f: IntegrationFinding): JSX.Element => details(f),
		},
	]
	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'integration-report',
		columns.map((c) => c.key),
	)

	return (
		<div class="integration-report integration-detail">
			<Show
				when={!integration.loading}
				fallback={<Loading message={t('integration.loadingOne')} />}
			>
				<Show when={integration()} fallback={<Empty message={t('integration.notFound')} />}>
					{(row: () => IntegrationJson): JSX.Element => (
						<IntegrationDetailHeader
							name={providerLabel(row().provider)}
							description={providerDescription(row().provider)}
							icon={IconTicket}
							configured
							status={providerStatus(row(), sync.pending())}
							lastSyncFailed={row().last_sync?.state === 'error'}
							lastRun={row().last_sync}
							connectionError={row().last_error}
							manageable={can('integrations.manage')}
							enabled={row().enabled}
							toggling={toggle.pending()}
							onToggle={(enabled: boolean) => void handleToggle(enabled)}
							syncing={sync.pending() || row().last_sync?.state === 'running'}
							onSync={() => void handleSync()}
							menuActions={menuActions()}
							onOpenSettings={() => selectView('settings')}
						/>
					)}
				</Show>
				<InlineError message={error()} />
				<Show when={integration()}>
					<DetailTabs
						label={t('integration.views')}
						tabs={views()}
						active={view()}
						onSelect={selectView}
					/>
					<Show when={view() === 'settings'}>
						{/* Not keyed: a refetch after a sync or toggle must not reset typed values. */}
						<Show when={integration()}>
							{(row: () => IntegrationJson): JSX.Element => (
								<ProviderSettings integration={row()} />
							)}
						</Show>
					</Show>
					{/* Separate instances: selections must not carry over between levels. */}
					<Show when={view() === 'tenants'}>
						<LinkBoardPanel
							provider={integration()?.provider ?? 'tanss'}
							entity_type="tenant"
							tenant={null}
							on_error={setError}
						/>
					</Show>
					<Show when={view() === 'devices'}>
						<LinkBoardPanel
							provider={integration()?.provider ?? 'tanss'}
							entity_type="device"
							tenant={selectedTenant()}
							on_error={setError}
						/>
					</Show>
					<Show when={view() === 'employees'}>
						<LinkBoardPanel
							provider={integration()?.provider ?? 'tanss'}
							entity_type="employee"
							tenant={selectedTenant()}
							on_error={setError}
						/>
					</Show>
					<Show when={view() === 'report'}>
						<p class="integration-meta integration-report-asof">
							{report()?.synced_at
								? t('integration.syncedAt', {
										time: formatTime(report()?.synced_at ?? 0),
									})
								: t('integration.neverSynced')}
						</p>
						<div class="toolbar-row">
							<SelectField
								id="integration-finding-filter"
								label={t('integration.finding')}
								value={kindFilter()}
								onChange={setKindFilter}
								emptyLabel={t('integration.allFindings', {
									count: report()?.findings.length ?? 0,
								})}
								options={FINDING_KINDS.filter((kind) => counts().has(kind)).map(
									(kind) => ({
										value: kind,
										label: `${findingKindLabel(kind)} (${counts().get(kind) ?? 0})`,
									}),
								)}
							/>
						</div>
						<Show
							when={!report.loading}
							fallback={<Loading message={t('integration.loadingReport')} />}
						>
							<Show
								when={rows().length > 0}
								fallback={<Empty message={t('integration.noFindings')} />}
							>
								<DataTable
									rows={rows}
									getRowId={findingKey}
									columns={columns}
									showColumnCustomizer
									savedLayoutsKey="integration-report"
									visibleColumns={visibleColumns}
									onVisibleColumnsChange={setVisibleColumns}
									rowActions={(f: IntegrationFinding): JSX.Element => (
										<div class="row-actions">{actions(f)}</div>
									)}
								/>
							</Show>
						</Show>
					</Show>
				</Show>
			</Show>

			<Show when={linkingTenant() !== null && integration()}>
				<ExternalTenantPicker
					provider={integration()?.provider ?? 'tanss'}
					on_select={handleLinkTenant}
					on_close={() => setLinkingTenant(null)}
				/>
			</Show>
		</div>
	)
}
