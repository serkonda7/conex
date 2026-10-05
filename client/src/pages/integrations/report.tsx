import { IconRefresh } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { FINDING_KINDS, type FindingKind, type IntegrationFinding } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import {
	create_external_device,
	type ExternalTenantJson,
	type ExternalTenantListItem,
	fetch_integration,
	fetch_integration_report,
	fetch_link_board,
	type IntegrationProvider,
	ignore_external,
	ignore_local_device,
	type LinkBoard,
	link_external,
	run_sync,
	start_sync,
	unlink_external,
} from '../../api/integrations'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { row_options, SelectField } from '../../components/form'
import { IconLabel } from '../../components/icon_label'
import { useTableColumns } from '../../components/list_page'
import { t, tp } from '../../i18n'
import {
	compareFieldLabel,
	deviceStatusLabel,
	findingKindLabel,
	providerLabel,
} from '../../i18n/labels'
import { createRecord } from '../../lib/resource'
import { parseId, queryParam, usePageMeta } from '../../lib/router'
import { can, canGlobal, isScoped } from '../../lib/session'
import {
	contextTenantId,
	contextTenantRows,
	tenantContext,
	tenantContextFilters,
} from '../../lib/tenant_context'
import { formatTime } from '../../lib/time'
import { ExternalTenantPicker } from './external_tenant_picker'
import { LinkBoardView } from './link_board'

function findingKey(f: IntegrationFinding): string {
	return [f.kind, f.tenant_id, f.device_id, f.external_id, f.field].join('|')
}

function detailText(f: IntegrationFinding): string {
	switch (f.kind) {
		case 'device_suggestion':
			return f.field !== null
				? t('integration.matchedBy', { field: compareFieldLabel(f.field) })
				: ''
		case 'device_status_mismatch':
			return `${deviceStatusLabel(f.local ?? '')} ≠ ${
				f.remote === 'active' ? t('integration.active') : t('integration.inactive')
			}`
		case 'device_field_mismatch':
		case 'tenant_customer_number_mismatch':
			return `${f.field !== null ? `${compareFieldLabel(f.field)}: ` : ''}${f.local ?? '—'} ≠ ${
				f.remote ?? '—'
			}`
		default:
			return ''
	}
}

type View = 'report' | 'tenants' | 'devices'

function parseView(raw: string): View {
	return raw === 'tenants' || raw === 'devices' ? raw : 'report'
}

/**
 * Link board of tenants, or of the devices of one tenant (picked here;
 * follows `default_tenant` whenever that changes).
 */
function LinkBoardPanel(props: {
	provider: IntegrationProvider
	entity_type: 'tenant' | 'device'
	default_tenant: number | null
	reload: number
	on_error: (message: string | null) => void
}): JSX.Element {
	const [tenant, setTenant] = createSignal<number | null>(props.default_tenant)
	createEffect(
		on(
			() => props.default_tenant,
			(next: number | null) => setTenant(next),
			{ defer: true },
		),
	)
	const [syncing, setSyncing] = createSignal(false)

	// Scoped users only see their own tenant: preselect it.
	const tenantOptions = createMemo(() => row_options(contextTenantRows()))
	const effectiveTenant = createMemo((): number | null => {
		const rows = contextTenantRows()
		return tenant() ?? (isScoped() && rows.length === 1 ? (rows[0]?.id ?? null) : null)
	})

	const source = createMemo(() =>
		props.entity_type === 'tenant'
			? { entity_type: props.entity_type, tenant: undefined, reload: props.reload }
			: effectiveTenant() !== null
				? {
						entity_type: props.entity_type,
						tenant: effectiveTenant() ?? undefined,
						reload: props.reload,
					}
				: null,
	)
	const [board, { refetch }] = createRecord(
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

	async function handleSyncTenant(): Promise<void> {
		const id = effectiveTenant()
		if (id === null) {
			return
		}
		props.on_error(null)
		setSyncing(true)
		const done = await run_sync(props.provider, id)
		setSyncing(false)
		if (Result.isError(done)) {
			props.on_error(done.error.message)
		}
		void refetch()
	}

	const editable = (): boolean =>
		props.entity_type === 'tenant'
			? canGlobal('integrations.manage')
			: can('integrations.manage')

	return (
		<div>
			<Show when={props.entity_type === 'device'}>
				<div class="toolbar-row">
					<Show when={!isScoped()}>
						<SelectField
							id="link-board-tenant"
							label={tp('entity.tenant', 1)}
							value={String(effectiveTenant() ?? '')}
							onChange={(v: string) => setTenant(parseId(v))}
							emptyLabel={t('integration.pickBoardTenant')}
							options={tenantOptions()}
						/>
					</Show>
					<Show when={can('integrations.manage') && board()?.external_tenant}>
						<button
							type="button"
							disabled={syncing()}
							onClick={() => void handleSyncTenant()}
						>
							<IconLabel icon={IconRefresh}>
								{syncing() ? t('integration.syncing') : t('integration.syncTenant')}
							</IconLabel>
						</button>
					</Show>
				</div>
			</Show>
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
								<Show when={current().external_tenant}>
									{(company: () => ExternalTenantJson): JSX.Element => (
										<p class="page-subtitle">
											{t('integration.linkedTo')}: {company().name}
											{company().display_id !== null
												? ` (${company().display_id})`
												: ''}
										</p>
									)}
								</Show>
								<LinkBoardView
									provider={props.provider}
									board={current()}
									editable={editable()}
									on_error={props.on_error}
									on_changed={() => void refetch()}
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
 * /integrations/:id — consistency report of one provider, plus link boards
 * (`?view=tenants|devices`) for side-by-side linking. The report and the
 * device board follow the tenant selector; `?tenant=` (from a tenant's
 * integration card) wins until the selector is switched. Rows offer the fitting fix: link, confirm
 * a suggestion, create the device externally, ignore, or unlink.
 */
export function IntegrationReportPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [kindFilter, setKindFilter] = createSignal('')
	const [linkingTenant, setLinkingTenant] = createSignal<number | null>(null)
	const [syncing, setSyncing] = createSignal(false)
	const [view, setView] = createSignal<View>(parseView(queryParam('view')))
	// Bumped after a full sync so an open link board reloads too.
	const [boardReload, setBoardReload] = createSignal(0)
	const [queryTenant, setQueryTenant] = createSignal(parseId(queryParam('tenant')))
	createEffect(on(tenantContext, () => setQueryTenant(null), { defer: true }))
	// Preselected tenant of the device board.
	const boardTenant = (): number | null => queryTenant() ?? contextTenantId()
	const views = (): { id: View; label: string }[] => [
		{ id: 'report', label: t('integration.viewReport') },
		// The tenant board lists every external company: global users only.
		...(isScoped() ? [] : [{ id: 'tenants' as const, label: t('integration.viewTenants') }]),
		{ id: 'devices', label: t('integration.viewDevices') },
	]

	const [integration] = createRecord(() => props.id, fetch_integration, setError)
	usePageMeta(() => ({
		name: integration()
			? t('integration.reportTitle', { name: providerLabel(integration()?.provider ?? '') })
			: undefined,
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

	const [report, { refetch }] = createRecord(
		source,
		(s) => fetch_integration_report(s.provider, s),
		setError,
	)

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

	async function run(action: () => Promise<Result<unknown, Error>>): Promise<void> {
		setError(null)
		const res = await action()
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	async function handleSync(clean = false): Promise<void> {
		const row = integration()
		if (!row) {
			return
		}
		if (
			clean &&
			!window.confirm(t('integration.confirmFullSync', { name: providerLabel(row.provider) }))
		) {
			return
		}
		setError(null)
		setSyncing(true)
		const done = await run_sync(row.provider, undefined, clean)
		setSyncing(false)
		if (Result.isError(done)) {
			setError(done.error.message)
		}
		void refetch()
		setBoardReload((n) => n + 1)
	}

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
		const unlink: JSX.Element = (
			<Show when={f.link_id !== null}>
				<button
					type="button"
					class="btn-small"
					onClick={(): void => void run(() => unlink_external(provider, f.link_id ?? 0))}
				>
					{t('integration.unlink')}
				</button>
			</Show>
		)
		switch (f.kind) {
			case 'tenant_unlinked':
				return (
					<Show when={canGlobal('integrations.manage')}>
						<button
							type="button"
							class="btn-small"
							onClick={() => setLinkingTenant(f.tenant_id)}
						>
							{t('integration.link')}
						</button>
					</Show>
				)
			case 'tenant_missing_in_conex':
				return (
					<Show when={canGlobal('integrations.manage')}>
						<button
							type="button"
							class="btn-small"
							onClick={() =>
								void run(() =>
									ignore_external(provider, 'tenant', f.external_id ?? ''),
								)
							}
						>
							{t('integration.ignore')}
						</button>
					</Show>
				)
			case 'tenant_stale':
				return <Show when={canGlobal('integrations.manage')}>{unlink}</Show>
			case 'device_suggestion':
				return (
					<Show when={can('integrations.manage')}>
						<button
							type="button"
							class="btn-small"
							onClick={() =>
								void run(() =>
									link_external(
										provider,
										'device',
										f.device_id ?? 0,
										f.external_id ?? '',
									),
								)
							}
						>
							{t('integration.confirmLink')}
						</button>
					</Show>
				)
			case 'device_missing_in_conex':
				return (
					<Show when={can('integrations.manage')}>
						<button
							type="button"
							class="btn-small"
							onClick={() =>
								void run(() =>
									ignore_external(provider, 'device', f.external_id ?? ''),
								)
							}
						>
							{t('integration.ignore')}
						</button>
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
						<button
							type="button"
							class="btn-small"
							onClick={() =>
								void run(() => ignore_local_device(provider, f.device_id ?? 0))
							}
						>
							{t('integration.ignore')}
						</button>
					</Show>
				)
			case 'device_stale':
			case 'device_tenant_mismatch':
				return <Show when={can('integrations.manage')}>{unlink}</Show>
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
			getValue: (f: IntegrationFinding): string => detailText(f),
		},
	]
	const [visibleColumns, setVisibleColumns] = useTableColumns(
		'integration-report',
		columns.map((c) => c.key),
	)

	return (
		<div>
			<div class="page-header">
				<h2>
					{t('integration.reportTitle', {
						name: providerLabel(integration()?.provider ?? 'tanss'),
					})}
				</h2>
				<Show when={can('integrations.manage') && integration()}>
					<div class="form-actions">
						<button
							type="button"
							disabled={syncing()}
							onClick={() => void handleSync()}
						>
							<IconLabel icon={IconRefresh}>
								{syncing() ? t('integration.syncing') : t('integration.syncNow')}
							</IconLabel>
						</button>
						<Show when={canGlobal('integrations.manage')}>
							<button
								type="button"
								disabled={syncing()}
								onClick={() => void handleSync(true)}
							>
								<IconLabel icon={IconRefresh}>
									{syncing()
										? t('integration.syncing')
										: t('integration.forceFullSync')}
								</IconLabel>
							</button>
						</Show>
					</div>
				</Show>
			</div>
			<p class="page-subtitle">
				{report()?.synced_at
					? t('integration.syncedAt', { time: formatTime(report()?.synced_at ?? 0) })
					: t('integration.neverSynced')}
			</p>

			<Show
				when={!integration.loading}
				fallback={<Loading message={t('integration.loadingOne')} />}
			>
				<Show when={integration()} fallback={<Empty message={t('integration.notFound')} />}>
					<div class="view-switch">
						<For each={views()}>
							{(item: { id: View; label: string }): JSX.Element => (
								<button
									type="button"
									aria-pressed={view() === item.id}
									onClick={() => {
										setError(null)
										setView(item.id)
									}}
								>
									{item.label}
								</button>
							)}
						</For>
					</div>
					{/* Separate instances: selections must not carry over between levels. */}
					<Show when={view() === 'tenants'}>
						<LinkBoardPanel
							provider={integration()?.provider ?? 'tanss'}
							entity_type="tenant"
							default_tenant={null}
							reload={boardReload()}
							on_error={setError}
						/>
					</Show>
					<Show when={view() === 'devices'}>
						<LinkBoardPanel
							provider={integration()?.provider ?? 'tanss'}
							entity_type="device"
							default_tenant={boardTenant()}
							reload={boardReload()}
							on_error={setError}
						/>
					</Show>
					<Show when={view() === 'report'}>
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
			<InlineError message={error()} />
		</div>
	)
}
