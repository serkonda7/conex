import { IconRefresh } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { FINDING_KINDS, type FindingKind, type IntegrationFinding } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import {
	type ExternalTenantJson,
	type ExternalTenantListItem,
	fetch_integration_report,
	fetch_integrations,
	fetch_link_board,
	type IntegrationJson,
	type IntegrationProvider,
	ignore_external,
	type LinkBoard,
	link_external,
	start_sync,
	unlink_external,
	wait_for_sync,
} from '../api_integrations'
import { DataTable, type DataTableColumn } from '../components/data_table'
import { ExternalTenantPicker } from '../components/external_tenant_picker'
import { Empty, InlineError, Loading } from '../components/feedback'
import { row_options, SelectField } from '../components/form'
import { LinkBoardView } from '../components/link_board'
import { t, tp } from '../i18n'
import {
	compareFieldLabel,
	deviceStatusLabel,
	findingKindLabel,
	providerLabel,
} from '../i18n/labels'
import { goTo, parseId, queryParam, usePageMeta } from '../router'
import { canWrite, canWriteGlobal, isScoped } from '../session'
import { contextTenantRows, tenantContextFilters } from '../tenant_context'
import { formatTime } from '../util/time'

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
		case 'tenant_name_mismatch':
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
 * defaults to `?tenant=` or the tenant context).
 */
function LinkBoardPanel(props: {
	provider: IntegrationProvider
	entity_type: 'tenant' | 'device'
	reload: number
	on_error: (message: string | null) => void
}): JSX.Element {
	const initialTenant = parseId(queryParam('tenant')) ?? tenantContextFilters().tenant ?? null
	const [tenant, setTenant] = createSignal<number | null>(initialTenant)
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
	const [board, { refetch }] = createResource(source, async (s) => {
		const res = await fetch_link_board(props.provider, s.entity_type, s.tenant)
		if (Result.isError(res)) {
			props.on_error(res.error.message)
			return null
		}
		return res.value
	})

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
		const started = await start_sync(props.provider, id)
		if (Result.isError(started)) {
			setSyncing(false)
			props.on_error(started.error.message)
			return
		}
		const done = await wait_for_sync(props.provider, started.value)
		setSyncing(false)
		if (Result.isError(done)) {
			props.on_error(done.error.message)
		} else if (done.value.state === 'error') {
			props.on_error(done.value.error)
		}
		void refetch()
	}

	const editable = (): boolean => (props.entity_type === 'tenant' ? canWriteGlobal() : canWrite())

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
					<Show when={canWrite() && board()?.external_tenant}>
						<button
							type="button"
							disabled={syncing()}
							onClick={() => void handleSyncTenant()}
						>
							<span aria-hidden="true" class="app-nav-icon">
								<IconRefresh size={14} />
							</span>{' '}
							{syncing() ? t('integration.syncing') : t('integration.syncTenant')}
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
 * (`?view=tenants|devices`) for side-by-side linking. The report honors the
 * tenant selector (or `?tenant=`); rows offer the fitting fix: link, confirm
 * a suggestion, ignore, or unlink.
 */
export function IntegrationReportPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [kindFilter, setKindFilter] = createSignal('')
	const [linkingTenant, setLinkingTenant] = createSignal<number | null>(null)
	const [syncing, setSyncing] = createSignal(false)
	const [view, setView] = createSignal<View>(parseView(queryParam('view')))
	// Bumped after a full sync so an open link board reloads too.
	const [boardReload, setBoardReload] = createSignal(0)
	const views = (): { id: View; label: string }[] => [
		{ id: 'report', label: t('integration.viewReport') },
		// The tenant board lists every external company: global users only.
		...(isScoped() ? [] : [{ id: 'tenants' as const, label: t('integration.viewTenants') }]),
		{ id: 'devices', label: t('integration.viewDevices') },
	]

	const [integration] = createResource(
		() => props.id,
		async (id: number): Promise<IntegrationJson | null> => {
			const res = await fetch_integrations()
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value.find((i) => i.id === id) ?? null
		},
	)
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
			...tenantContextFilters(parseId(queryParam('tenant')) ?? undefined),
		}
	})

	const [report, { refetch }] = createResource(source, async (s) => {
		const res = await fetch_integration_report(s.provider, s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

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
		const started = await start_sync(row.provider, undefined, clean)
		if (Result.isError(started)) {
			setSyncing(false)
			setError(started.error.message)
			return
		}
		const done = await wait_for_sync(row.provider, started.value)
		setSyncing(false)
		if (Result.isError(done)) {
			setError(done.error.message)
		} else if (done.value.state === 'error') {
			setError(done.value.error)
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
					<Show when={canWriteGlobal()}>
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
					<Show when={canWriteGlobal()}>
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
				return <Show when={canWriteGlobal()}>{unlink}</Show>
			case 'device_suggestion':
				return (
					<Show when={canWrite()}>
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
					<Show when={canWrite()}>
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
			case 'device_stale':
			case 'device_tenant_mismatch':
				return <Show when={canWrite()}>{unlink}</Show>
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
					<a
						href={`/tenants/${f.tenant_id}`}
						onClick={(e: MouseEvent): void => goTo(e, `/tenants/${f.tenant_id}`)}
					>
						{f.tenant_name}
					</a>
				) : (
					'—'
				),
		},
		{
			key: 'device',
			label: tp('entity.device', 1),
			getValue: (f: IntegrationFinding): JSX.Element =>
				f.device_id !== null ? (
					<a
						href={`/devices/${f.device_id}`}
						onClick={(e: MouseEvent): void => goTo(e, `/devices/${f.device_id}`)}
					>
						{f.device_name}
					</a>
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

	return (
		<div>
			<div class="page-header">
				<h2>
					{t('integration.reportTitle', {
						name: providerLabel(integration()?.provider ?? 'tanss'),
					})}
				</h2>
				<Show when={canWrite() && integration()}>
					<div class="form-actions">
						<button
							type="button"
							disabled={syncing()}
							onClick={() => void handleSync()}
						>
							<span aria-hidden="true" class="app-nav-icon">
								<IconRefresh size={14} />
							</span>{' '}
							{syncing() ? t('integration.syncing') : t('integration.syncNow')}
						</button>
						<Show when={canWriteGlobal()}>
							<button
								type="button"
								disabled={syncing()}
								onClick={() => void handleSync(true)}
							>
								<span aria-hidden="true" class="app-nav-icon">
									<IconRefresh size={14} />
								</span>{' '}
								{syncing()
									? t('integration.syncing')
									: t('integration.forceFullSync')}
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
							reload={boardReload()}
							on_error={setError}
						/>
					</Show>
					<Show when={view() === 'devices'}>
						<LinkBoardPanel
							provider={integration()?.provider ?? 'tanss'}
							entity_type="device"
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
