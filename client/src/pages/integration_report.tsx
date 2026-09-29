import { IconRefresh } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { FINDING_KINDS, type FindingKind, type IntegrationFinding } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, Show } from 'solid-js'
import {
	type ExternalTenantListItem,
	fetch_integration_report,
	fetch_integrations,
	type IntegrationJson,
	ignore_external,
	link_external,
	start_sync,
	unlink_external,
	wait_for_sync,
} from '../api_integrations'
import { DataTable, type DataTableColumn } from '../components/data_table'
import { ExternalTenantPicker } from '../components/external_tenant_picker'
import { Empty, InlineError, Loading } from '../components/feedback'
import { SelectField } from '../components/form'
import { t, tp } from '../i18n'
import {
	compareFieldLabel,
	deviceStatusLabel,
	findingKindLabel,
	providerLabel,
} from '../i18n/labels'
import { goTo, parseId, queryParam, usePageMeta } from '../router'
import { canWrite, canWriteGlobal } from '../session'
import { tenantContextFilters } from '../tenant_context'
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

/**
 * /integrations/:id — consistency report of one provider. Honors the tenant
 * selector (or `?tenant=`); rows offer the fitting fix: link, confirm a
 * suggestion, ignore, or unlink.
 */
export function IntegrationReportPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [kindFilter, setKindFilter] = createSignal('')
	const [linkingTenant, setLinkingTenant] = createSignal<number | null>(null)
	const [syncing, setSyncing] = createSignal(false)

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

	async function handleSync(): Promise<void> {
		const row = integration()
		if (!row) {
			return
		}
		setError(null)
		setSyncing(true)
		const started = await start_sync(row.provider)
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
