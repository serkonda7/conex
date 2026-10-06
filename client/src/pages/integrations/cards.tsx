/**
 * Integration cards on the tenant, device and employee detail pages: one
 * card per configured provider with the linked external object, link/unlink
 * actions and (tenants) finding counts or (devices, employees) a field
 * comparison.
 */
import { Result } from 'better-result'
import type {
	ExternalDeviceJson,
	ExternalEmployeeJson,
	ExternalLinkJson,
	ExternalTenantJson,
	FieldComparison,
	FindingKind,
} from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createMemo, createSignal, For, Show } from 'solid-js'
import {
	type ExternalTenantListItem,
	fetch_device_integration,
	fetch_employee_integration,
	fetch_integrations,
	fetch_tenant_integration,
	type IntegrationJson,
	link_external,
	run_sync,
	unlink_external,
} from '../../api/integrations'
import { InlineError } from '../../components/feedback'
import { SelectField } from '../../components/form'
import { t } from '../../i18n'
import {
	compareFieldLabel,
	compareValueLabel,
	findingKindLabel,
	providerLabel,
} from '../../i18n/labels'
import { createRecord, createRowsFor } from '../../lib/resource'
import { can, canGlobal } from '../../lib/session'
import { ExternalTenantPicker } from './external_tenant_picker'

/**
 * Configured, enabled integrations (empty on error: the cards just hide).
 * The list needs `integrations.manage`, so other users never load (or see) cards.
 */
function useIntegrations(): () => IntegrationJson[] {
	const [integrations] = createRowsFor(() => can('integrations.manage'), fetch_integrations)
	return () => (integrations() ?? []).filter((i) => i.enabled)
}

function TenantCard(props: { integration: IntegrationJson; tenantId: number }): JSX.Element {
	const provider = (): IntegrationJson['provider'] => props.integration.provider
	const [error, setError] = createSignal<string | null>(null)
	const [picking, setPicking] = createSignal(false)
	const [syncing, setSyncing] = createSignal(false)
	const [status, { refetch }] = createRecord(
		() => props.tenantId,
		(id: number) => fetch_tenant_integration(provider(), id),
		setError,
	)
	const findingCounts = createMemo(
		() => Object.entries(status()?.finding_counts ?? {}) as [FindingKind, number][],
	)

	async function run(action: () => Promise<Result<unknown, Error>>): Promise<void> {
		setError(null)
		const res = await action()
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	function handlePick(item: ExternalTenantListItem): void {
		setPicking(false)
		void run(async () => {
			const linked = await link_external(
				provider(),
				'tenant',
				props.tenantId,
				item.external_id,
			)
			if (Result.isError(linked)) {
				return linked
			}
			// Fetch the company's devices right away so the counts are useful.
			return run_sync(provider(), props.tenantId)
		})
	}

	async function handleSync(): Promise<void> {
		setSyncing(true)
		await run(() => run_sync(provider(), props.tenantId))
		setSyncing(false)
	}

	const reportHref = (): string =>
		`/integrations/${props.integration.id}?tenant=${props.tenantId}`

	return (
		<section class="card" aria-label={providerLabel(provider())}>
			<div class="page-header">
				<h3>{providerLabel(provider())}</h3>
				<div class="form-actions">
					<Show when={can('integrations.manage') && status()?.link}>
						<button
							type="button"
							disabled={syncing()}
							onClick={() => void handleSync()}
						>
							{syncing() ? t('integration.syncing') : t('integration.syncNow')}
						</button>
					</Show>
					<Show when={canGlobal('integrations.manage')}>
						<button type="button" onClick={() => setPicking(true)}>
							{status()?.link ? t('integration.changeLink') : t('integration.link')}
						</button>
						<Show when={status()?.link}>
							{(link: () => NonNullable<ReturnType<typeof status>>['link']) => (
								<button
									type="button"
									class="btn-danger"
									onClick={() =>
										void run(() => unlink_external(provider(), link()?.id ?? 0))
									}
								>
									{t('integration.unlink')}
								</button>
							)}
						</Show>
					</Show>
				</div>
			</div>
			<dl class="detail-grid">
				<dt>{t('integration.company')}</dt>
				<dd>
					<Show
						when={status()?.link}
						fallback={<span class="text-danger">{t('integration.notLinked')}</span>}
					>
						<Show
							when={status()?.external}
							fallback={
								<span class="text-danger">
									{t('integration.staleCompany', {
										id: status()?.link?.external_id ?? '',
									})}
								</span>
							}
						>
							{status()?.external?.name}
							<Show when={status()?.external?.display_id}>
								{' '}
								<small>({status()?.external?.display_id})</small>
							</Show>
							<Show when={status()?.external?.active === false}>
								{' '}
								<span class="badge badge-decommissioned">
									{t('integration.inactive')}
								</span>
							</Show>
						</Show>
					</Show>
				</dd>
				<dt>{t('integration.findings')}</dt>
				<dd>
					<Show when={findingCounts().length > 0} fallback={t('integration.noFindings')}>
						<For each={findingCounts()}>
							{([kind, count]: [FindingKind, number]): JSX.Element => (
								<span class="badge">
									{findingKindLabel(kind)}: {count}
								</span>
							)}
						</For>
					</Show>
				</dd>
			</dl>
			<p>
				<a href={reportHref()}>{t('integration.openReport')}</a>
			</p>
			<Show when={picking()}>
				<ExternalTenantPicker
					provider={provider()}
					on_select={handlePick}
					on_close={() => setPicking(false)}
				/>
			</Show>
			<InlineError message={error()} />
		</section>
	)
}

/** Integration cards for `/tenants/:id`. */
export function TenantIntegrationCards(props: { tenantId: number }): JSX.Element {
	const integrations = useIntegrations()
	return (
		<For each={integrations()}>
			{(integration: IntegrationJson): JSX.Element => (
				<TenantCard integration={integration} tenantId={props.tenantId} />
			)}
		</For>
	)
}

function deviceLabel(d: ExternalDeviceJson): string {
	const parts = [d.name]
	if (d.serial !== null) {
		parts.push(`(${d.serial})`)
	}
	if (!d.active) {
		parts.push(`· ${t('integration.inactive')}`)
	}
	return parts.join(' ')
}

/** Value of an equal (or one-sided) field comparison. */
function fieldText(cmp: FieldComparison, provider: string): string {
	const local = compareValueLabel(cmp.field, cmp.local)
	const remote = compareValueLabel(cmp.field, cmp.remote)
	if (local !== null && remote === null) {
		return t('integration.onlyLocal', { value: local })
	}
	if (local === null && remote !== null) {
		return t('integration.onlyRemote', { provider, value: remote })
	}
	return local ?? '—'
}

/** Link status of a device or employee, as the status endpoints return it. */
interface LinkedStatus<E extends { external_id: string; name: string; active: boolean }> {
	link: ExternalLinkJson | null
	external: E | null
	fields: FieldComparison[]
	external_tenant: ExternalTenantJson | null
	candidates: E[]
}

/**
 * Card of one linked object (device or employee): the linked external
 * object with a field comparison, or a picker over the unlinked external
 * objects of the tenant's company.
 */
function LinkedObjectCard<E extends { external_id: string; name: string; active: boolean }>(props: {
	integration: IntegrationJson
	entityType: 'device' | 'employee'
	id: number
	load: (
		provider: IntegrationJson['provider'],
		id: number,
	) => Promise<Result<LinkedStatus<E>, Error>>
	notLinkedText: string
	pickText: string
	staleText: (externalId: string) => string
	candidateLabel: (candidate: E) => string
}): JSX.Element {
	const provider = (): IntegrationJson['provider'] => props.integration.provider
	const [error, setError] = createSignal<string | null>(null)
	const [candidate, setCandidate] = createSignal('')
	const [status, { refetch }] = createRecord(
		() => props.id,
		(id: number) => props.load(provider(), id),
		setError,
	)

	async function run(action: () => Promise<Result<unknown, Error>>): Promise<void> {
		setError(null)
		const res = await action()
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setCandidate('')
		void refetch()
	}

	return (
		<section class="card" aria-label={providerLabel(provider())}>
			<div class="page-header">
				<h3>{providerLabel(provider())}</h3>
				<Show when={can('integrations.manage') && status()?.link}>
					<div class="form-actions">
						<button
							type="button"
							class="btn-danger"
							onClick={() =>
								void run(() => unlink_external(provider(), status()?.link?.id ?? 0))
							}
						>
							{t('integration.unlink')}
						</button>
					</div>
				</Show>
			</div>
			<Show
				when={status()?.link}
				fallback={
					<Show
						when={status()?.external_tenant}
						fallback={<p class="empty">{t('integration.tenantNotLinked')}</p>}
					>
						<p class="empty">{props.notLinkedText}</p>
						<Show
							when={
								can('integrations.manage') && (status()?.candidates.length ?? 0) > 0
							}
						>
							<SelectField
								id={`integration-${provider()}-${props.entityType}-link`}
								label={t('integration.linkTo')}
								value={candidate()}
								onChange={(value: string) => {
									setCandidate(value)
									void run(() =>
										link_external(
											provider(),
											props.entityType,
											props.id,
											value,
										),
									)
								}}
								emptyLabel={props.pickText}
								options={(status()?.candidates ?? []).map((c) => ({
									value: c.external_id,
									label: props.candidateLabel(c),
								}))}
							/>
						</Show>
					</Show>
				}
			>
				<Show
					when={status()?.external}
					fallback={
						<p class="text-danger">
							{props.staleText(status()?.link?.external_id ?? '')}
						</p>
					}
				>
					<dl class="detail-grid">
						<dt>{t('integration.linkedTo')}</dt>
						<dd>
							{status()?.external?.name}{' '}
							<Show when={status()?.external?.active === false}>
								<span class="badge badge-decommissioned">
									{t('integration.inactive')}
								</span>
							</Show>
						</dd>
						<For each={status()?.fields ?? []}>
							{(cmp: FieldComparison): JSX.Element => (
								<>
									<dt>{compareFieldLabel(cmp.field)}</dt>
									<dd>
										<Show
											when={!cmp.equal}
											fallback={fieldText(cmp, providerLabel(provider()))}
										>
											<span class="text-danger">
												{t('integration.valueMismatch', {
													local:
														compareValueLabel(cmp.field, cmp.local) ??
														'—',
													provider: providerLabel(provider()),
													remote:
														compareValueLabel(cmp.field, cmp.remote) ??
														'—',
												})}
											</span>
										</Show>
									</dd>
								</>
							)}
						</For>
					</dl>
				</Show>
			</Show>
			<InlineError message={error()} />
		</section>
	)
}

function DeviceCard(props: { integration: IntegrationJson; deviceId: number }): JSX.Element {
	return (
		<LinkedObjectCard
			integration={props.integration}
			entityType="device"
			id={props.deviceId}
			load={fetch_device_integration}
			notLinkedText={t('integration.deviceNotLinked')}
			pickText={t('integration.pickDevice')}
			staleText={(id: string) => t('integration.staleDevice', { id })}
			candidateLabel={deviceLabel}
		/>
	)
}

function employeeLabel(e: ExternalEmployeeJson): string {
	const parts = [e.name]
	if (e.email !== null) {
		parts.push(`(${e.email})`)
	}
	if (!e.active) {
		parts.push(`· ${t('integration.inactive')}`)
	}
	return parts.join(' ')
}

function EmployeeCard(props: { integration: IntegrationJson; employeeId: number }): JSX.Element {
	return (
		<LinkedObjectCard
			integration={props.integration}
			entityType="employee"
			id={props.employeeId}
			load={fetch_employee_integration}
			notLinkedText={t('integration.employeeNotLinked')}
			pickText={t('integration.pickEmployee')}
			staleText={(id: string) => t('integration.staleEmployee', { id })}
			candidateLabel={employeeLabel}
		/>
	)
}

/** Integration cards for `/employees/:id`. */
export function EmployeeIntegrationCards(props: { employeeId: number }): JSX.Element {
	const integrations = useIntegrations()
	return (
		<For each={integrations()}>
			{(integration: IntegrationJson): JSX.Element => (
				<EmployeeCard integration={integration} employeeId={props.employeeId} />
			)}
		</For>
	)
}

/** Integration cards for `/devices/:id`. */
export function DeviceIntegrationCards(props: { deviceId: number }): JSX.Element {
	const integrations = useIntegrations()
	return (
		<For each={integrations()}>
			{(integration: IntegrationJson): JSX.Element => (
				<DeviceCard integration={integration} deviceId={props.deviceId} />
			)}
		</For>
	)
}
