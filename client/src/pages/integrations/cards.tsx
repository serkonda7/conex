/**
 * Integration cards on the device and employee detail pages: one card per
 * configured provider with the linked external object, link/unlink actions
 * and a field comparison. Also the tenant integration status behind the
 * tenant page's "Needs attention" list.
 */
import { IconUnlink } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type {
	ExternalDeviceJson,
	ExternalEmployeeJson,
	ExternalLinkJson,
	ExternalTenantJson,
	FieldComparison,
	FindingKind,
	TenantIntegrationStatus,
} from 'shared/src/schemas'
import type { JSX, Resource } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	fetch_device_integration,
	fetch_employee_integration,
	fetch_integrations,
	fetch_tenant_integration,
	type IntegrationJson,
	link_external,
	unlink_external,
} from '../../api/integrations'
import { Empty, InlineError } from '../../components/feedback'
import { SelectField } from '../../components/form'
import { t } from '../../i18n'
import { compareFieldLabel, compareValueLabel, providerLabel } from '../../i18n/labels'
import { createRecord, createRowsFor, useAction } from '../../lib/resource'
import { can } from '../../lib/session'

/**
 * Configured, enabled integrations (empty on error: the cards just hide).
 * The list needs `integrations.manage`, so other users never load (or see) cards.
 */
function useIntegrations(): () => IntegrationJson[] {
	const [integrations] = createRowsFor(() => can('integrations.manage'), fetch_integrations)
	return () => (integrations() ?? []).filter((i) => i.enabled)
}

/** Integration status of a tenant, loaded once per configured provider. */
export interface TenantIntegration {
	integration: IntegrationJson
	status: TenantIntegrationStatus | null
	error: string | null
}

/**
 * Status of every enabled integration for the tenant, for the tenant
 * page's "Needs attention" list.
 */
export function useTenantIntegrations(tenantId: () => number): Resource<TenantIntegration[]> {
	const integrations = useIntegrations()
	const [statuses] = createResource(
		() => ({ tenant: tenantId(), list: integrations() }),
		async (q): Promise<TenantIntegration[]> =>
			Promise.all(
				q.list.map(async (integration: IntegrationJson): Promise<TenantIntegration> => {
					const res = await fetch_tenant_integration(integration.provider, q.tenant)
					return Result.isError(res)
						? { integration, status: null, error: res.error.message }
						: { integration, status: res.value, error: null }
				}),
			),
	)
	return statuses
}

/** Integration report of the provider, narrowed to the tenant (and a finding kind). */
export function tenantReportHref(
	integration: IntegrationJson,
	tenantId: number,
	kind?: FindingKind,
): string {
	const base = `/integrations/${integration.id}?tenant=${tenantId}`
	return kind === undefined ? base : `${base}&kind=${kind}`
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

	const action = useAction(setError)

	async function run(request: () => Promise<Result<unknown, Error>>): Promise<void> {
		if (await action.run(request)) {
			setCandidate('')
			void refetch()
		}
	}

	return (
		<section class="card" aria-label={providerLabel(provider())}>
			<div class="page-header">
				<h3>{providerLabel(provider())}</h3>
				<Show when={can('integrations.manage') && status()?.link}>
					<div class="form-actions">
						<button
							type="button"
							class="icon-btn icon-btn-danger"
							title={t('integration.unlink')}
							aria-label={t('integration.unlink')}
							onClick={() =>
								void run(() => unlink_external(provider(), status()?.link?.id ?? 0))
							}
						>
							<IconUnlink size={20} />
						</button>
					</div>
				</Show>
			</div>
			<Show
				when={status()?.link}
				fallback={
					<Show
						when={status()?.external_tenant}
						fallback={<Empty message={t('integration.tenantNotLinked')} />}
					>
						<Empty message={props.notLinkedText} />
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
											fallback={
												compareValueLabel(cmp.field, cmp.local) ?? '—'
											}
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
