import { IconBan, IconLinkPlus, IconReportAnalytics, IconUnlink } from '@tabler/icons-solidjs'
import type { Result } from 'better-result'
import {
	EMPLOYEE_PUSH_FIELDS,
	type EmployeePushField,
	type ExternalPullField,
	type ExternalPushField,
	FINDING_KINDS,
	type FindingKind,
	type IntegrationFinding,
} from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { update_device } from '../../api/devices'
import {
	create_external_device,
	deactivate_external_employee,
	type ExternalTenantListItem,
	fetch_integration_report,
	fetch_integrations,
	type IntegrationJson,
	type IntegrationProvider,
	ignore_external,
	ignore_local,
	import_external_employees,
	link_external,
	unlink_external,
	update_external_device,
	update_external_employee,
} from '../../api/integrations'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { SelectField } from '../../components/form'
import { useTableColumns } from '../../components/list_page'
import { t, tp } from '../../i18n'
import {
	compareFieldLabel,
	compareValueLabel,
	deviceStatusLabel,
	findingKindLabel,
	providerLabel,
} from '../../i18n/labels'
import { createRecord, createRows, useAction } from '../../lib/resource'
import { parseId, queryParam, usePageMeta } from '../../lib/router'
import { can, canGlobal } from '../../lib/session'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'
import { formatTime } from '../../lib/time'
import { ExternalTenantPicker } from './external_tenant_picker'

/** Field of a mismatch that can be written to the external system. */
function pushField(
	f: IntegrationFinding,
	pushable: readonly ExternalPushField[],
): ExternalPushField | null {
	return f.kind === 'device_mismatch' && f.local !== null && isOneOf(pushable, f.field)
		? f.field
		: null
}

/** Field of a device mismatch whose external value can be taken into conex. */
function pullField(
	f: IntegrationFinding,
	pullable: readonly ExternalPullField[],
): ExternalPullField | null {
	return f.kind === 'device_mismatch' && f.remote !== null && isOneOf(pullable, f.field)
		? f.field
		: null
}

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
	return (values as readonly string[]).includes(value ?? '')
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
	return [f.kind, f.tenant_id, f.site_id, f.device_id, f.external_id, f.field, f.local].join('|')
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

/**
 * /integrations/report — consistency report of one enabled integration
 * (`?provider=`, else the first one), switched in the toolbar. It follows the
 * tenant selector; `?tenant=` (from a tenant's "Needs attention" list) wins
 * until the selector is switched, and `?kind=` preselects the finding filter.
 * Rows offer the fitting fix: link, confirm a suggestion, create the device
 * externally, ignore, or unlink. Linking objects in bulk happens on the
 * matching page; syncing and settings on the integration's detail page.
 */
export function IntegrationReportPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [kindFilter, setKindFilter] = createSignal<string>(parseKind(queryParam('kind')))
	// Tenant (or site, for site-level providers) being linked via the picker.
	const [linkingTenant, setLinkingTenant] = createSignal<number | null>(null)
	const [chosen, setChosen] = createSignal(queryParam('provider'))
	const [queryTenant, setQueryTenant] = createSignal(parseId(queryParam('tenant')))
	createEffect(on(tenantContext, () => setQueryTenant(null), { defer: true }))

	usePageMeta(() => ({ name: t('integration.viewReport') }))

	const [integrations] = createRows(fetch_integrations, setError)
	const enabled = createMemo(() => (integrations() ?? []).filter((i) => i.enabled))
	const integration = createMemo(
		(): IntegrationJson | undefined =>
			enabled().find((i) => i.provider === chosen()) ?? enabled()[0],
	)

	// UniFi consoles link to sites: the report lists sites.
	const tenantLevel = (): 'tenant' | 'site' => integration()?.capabilities.link_level ?? 'tenant'

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

	async function run(request: () => Promise<Result<unknown, Error>>): Promise<void> {
		await action.run(request)
	}

	function switchProvider(provider: IntegrationProvider): void {
		setError(null)
		// Finding kinds differ per provider.
		setKindFilter('')
		setChosen(provider)
	}

	function handleLinkTenant(item: ExternalTenantListItem): void {
		const row = integration()
		const tenant = linkingTenant()
		setLinkingTenant(null)
		if (!row || tenant === null) {
			return
		}
		void run(() => link_external(row.provider, tenantLevel(), tenant, item.external_id))
	}

	function actions(f: IntegrationFinding): JSX.Element {
		const row = integration()
		if (!row) {
			return null
		}
		const provider = row.provider
		const capabilities = row.capabilities
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
			case 'site_unlinked': {
				const level = f.kind === 'site_unlinked' ? 'site' : 'tenant'
				const id = level === 'site' ? f.site_id : f.tenant_id
				return (
					<Show when={canGlobal('integrations.manage') && id !== null}>
						<button
							type="button"
							class="icon-btn icon-btn-connect"
							title={t('integration.link')}
							aria-label={t('integration.link')}
							onClick={() => setLinkingTenant(id)}
						>
							<IconLinkPlus size={20} />
						</button>
						{/* Sites without UniFi gear are ignored right here. */}
						{level === 'site' &&
							ignoreButton(() => ignore_local(provider, 'site', id ?? 0))}
					</Show>
				)
			}
			case 'tenant_missing_in_conex':
				return (
					<Show when={canGlobal('integrations.manage')}>
						{ignoreButton(() =>
							ignore_external(provider, tenantLevel(), f.external_id ?? ''),
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
						{/* Providers without create_device cannot accept a device created in conex. */}
						<Show when={capabilities.create_device}>
							<button
								type="button"
								class="btn-small"
								onClick={() =>
									void run(() =>
										create_external_device(provider, f.device_id ?? 0),
									)
								}
							>
								{t('integration.createExternal', {
									provider: providerLabel(provider),
								})}
							</button>
						</Show>
						{ignoreButton(() => ignore_local(provider, 'device', f.device_id ?? 0))}
					</Show>
				)
			case 'device_stale':
				return <Show when={can('integrations.manage')}>{unlink}</Show>
			case 'device_mismatch': {
				const field = pushField(f, capabilities.device_push)
				const pull = pullField(f, capabilities.device_pull)
				return (
					<Show when={can('integrations.manage')}>
						<Show when={f.field === 'tenant' || f.field === 'site'}>{unlink}</Show>
						{pull !== null && can('edit') && (
							<button
								type="button"
								class="btn-small"
								onClick={() =>
									void run(() =>
										update_device(f.device_id ?? 0, { [pull]: f.remote }),
									)
								}
							>
								{t('integration.updateConex')}
							</button>
						)}
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
						{capabilities.push &&
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
						{capabilities.push && f.external_id !== null && deactivate}
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
						{capabilities.push &&
							f.field === 'status' &&
							f.local === 'inactive' &&
							f.remote === 'active' &&
							f.external_id !== null &&
							deactivate}
						{capabilities.push && field !== null && (
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
				<span class="badge">
					{findingKindLabel(f.kind, integration()?.provider ?? 'tanss')}
				</span>
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
			key: 'site',
			label: tp('entity.site', 1),
			getValue: (f: IntegrationFinding): JSX.Element =>
				f.site_id !== null ? <a href={`/sites/${f.site_id}`}>{f.site_name}</a> : '—',
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
		<div class="integration-report">
			<div class="integrations-header">
				<span class="page-header-icon" aria-hidden="true">
					<IconReportAnalytics size={20} />
				</span>
				<div class="matching-heading">
					<h2>{t('integration.viewReport')}</h2>
					<p class="text-muted">{t('integration.reportIntro')}</p>
				</div>
			</div>
			<InlineError message={error()} />
			<Show
				when={!integrations.loading}
				fallback={
					<Loading message={t('list.loading', { noun: tp('noun.integration', 2) })} />
				}
			>
				<Show
					when={integration()}
					fallback={<Empty message={t('integration.reportNoIntegrations')} />}
				>
					{(row: () => IntegrationJson): JSX.Element => (
						<>
							<div class="toolbar-row">
								<Show when={enabled().length > 1}>
									<fieldset
										class="link-board-filter"
										aria-label={tp('entity.integration', 1)}
									>
										<For each={enabled()}>
											{(i: IntegrationJson): JSX.Element => (
												<button
													type="button"
													class="link-board-filter-option"
													aria-pressed={i.provider === row().provider}
													onClick={(): void => switchProvider(i.provider)}
												>
													{providerLabel(i.provider)}
												</button>
											)}
										</For>
									</fieldset>
								</Show>
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
											label: `${findingKindLabel(kind, row().provider)} (${counts().get(kind) ?? 0})`,
										}),
									)}
								/>
							</div>
							<p class="integration-meta integration-report-asof">
								{report()?.synced_at
									? t('integration.syncedAt', {
											time: formatTime(report()?.synced_at ?? 0),
										})
									: t('integration.neverSynced')}{' '}
								<a href={`/integrations/${row().id}`}>
									{t('integration.openIntegration', {
										name: providerLabel(row().provider),
									})}
								</a>
							</p>
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
										// The site column only applies to site-level providers.
										visibleColumns={() =>
											visibleColumns().filter(
												(key) => key !== 'site' || tenantLevel() === 'site',
											)
										}
										onVisibleColumnsChange={setVisibleColumns}
										rowActions={(f: IntegrationFinding): JSX.Element => (
											<div class="row-actions">{actions(f)}</div>
										)}
									/>
								</Show>
							</Show>
						</>
					)}
				</Show>
			</Show>

			<Show when={linkingTenant() !== null && integration()}>
				<ExternalTenantPicker
					provider={integration()?.provider ?? 'tanss'}
					customer_numbers={integration()?.capabilities.customer_numbers ?? false}
					on_select={handleLinkTenant}
					on_close={() => setLinkingTenant(null)}
				/>
			</Show>
		</div>
	)
}
