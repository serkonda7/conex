/**
 * Microsoft 365 parts of the integration and tenant pages: the consented
 * customer tenants on the integration card, and the connect / consent link /
 * disconnect card on a conex tenant (global `integrations.manage` only).
 */
import { IconCopy, IconTrash, IconUnlink } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { createSignal, For, type JSX, Show } from 'solid-js'
import {
	connect_m365_tenant,
	delete_m365_tenant,
	fetch_integrations,
	fetch_m365_consent_link,
	fetch_m365_tenants,
	fetch_tenant_integration,
	type IntegrationJson,
	type M365ConsentLinkJson,
	type M365TenantJson,
	type TenantIntegrationStatus,
	unlink_external,
} from '../../api/integrations'
import { Empty, InlineError } from '../../components/feedback'
import { Hint, TextField } from '../../components/form'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { createRecord, createRowsFor, useAction } from '../../lib/resource'
import { canGlobal } from '../../lib/session'
import { formatDate, formatTime } from '../../lib/time'

/** One link of the tenant status card. */
type TenantLink = TenantIntegrationStatus['links'][number]

/** Days before the client secret's expiry from which the card warns. */
const EXPIRY_WARNING_DAYS = 30

function setting(integration: IntegrationJson, key: string): string {
	const value = integration.settings[key]
	return typeof value === 'string' ? value : ''
}

/** Fetch state of a consented tenant: its last error, or when it was last read. */
function TenantFetchState(props: { tenant: M365TenantJson }): JSX.Element {
	return (
		<Show
			when={props.tenant.last_error}
			fallback={
				props.tenant.last_ok_at === null
					? '—'
					: t('integration.connectedAt', { time: formatTime(props.tenant.last_ok_at) })
			}
		>
			<span class="text-danger">{props.tenant.last_error}</span>
		</Show>
	)
}

/** Secret expiry date, flagged when it is close or past. */
function SecretExpiry(props: { date: string }): JSX.Element {
	const daysLeft = (): number =>
		Math.floor((new Date(props.date).getTime() - Date.now()) / 86_400_000)
	return (
		<span class={daysLeft() < EXPIRY_WARNING_DAYS ? 'text-danger' : undefined}>
			{formatDate(props.date)}
			<Show when={daysLeft() < 0}>{` · ${t('m365.secretExpired')}`}</Show>
			<Show when={daysLeft() >= 0 && daysLeft() < EXPIRY_WARNING_DAYS}>
				{` · ${tp('m365.secretExpiresSoon', daysLeft())}`}
			</Show>
		</span>
	)
}

/** App settings and the consented customer tenants, on the integration card. */
export function M365Details(props: { integration: IntegrationJson }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [tenants] = createRowsFor(
		() => canGlobal('integrations.manage'),
		fetch_m365_tenants,
		setError,
	)
	const action = useAction(setError)

	async function handleRemove(tenant: M365TenantJson): Promise<void> {
		const name = tenant.display_name ?? tenant.ms_tenant_id
		if (!window.confirm(t('m365.confirmRemoveTenant', { name }))) {
			return
		}
		await action.run(() => delete_m365_tenant(tenant.ms_tenant_id))
	}

	return (
		<>
			<dl class="detail-grid">
				<dt>{t('m365.clientId')}</dt>
				<dd>{setting(props.integration, 'client_id') || '—'}</dd>
				<dt>{t('m365.homeTenant')}</dt>
				<dd>{setting(props.integration, 'home_tenant') || '—'}</dd>
				<Show when={setting(props.integration, 'secret_expires')}>
					{(date: () => string) => (
						<>
							<dt>{t('m365.secretExpires')}</dt>
							<dd>
								<SecretExpiry date={date()} />
							</dd>
						</>
					)}
				</Show>
			</dl>
			<Show when={canGlobal('integrations.manage')}>
				<h4>{t('m365.consentedTenants')}</h4>
				<Show
					when={(tenants() ?? []).length > 0}
					fallback={<Empty message={t('m365.noConsentedTenants')} />}
				>
					<ul class="tenant-rows">
						<For each={tenants()}>
							{(tenant: M365TenantJson): JSX.Element => (
								<li>
									<span class="tenant-row-text">
										<Show
											when={tenant.linked_tenant_id}
											fallback={tenant.display_name ?? tenant.ms_tenant_id}
										>
											{(id: () => number) => (
												<a href={`/tenants/${id()}`}>
													{tenant.display_name ?? tenant.ms_tenant_id}
												</a>
											)}
										</Show>{' '}
										<small class="text-muted">
											{tenant.default_domain ?? tenant.ms_tenant_id}
										</small>
										{' · '}
										<TenantFetchState tenant={tenant} />
									</span>
									<button
										type="button"
										class="icon-btn icon-btn-danger"
										title={t('m365.removeTenant')}
										aria-label={t('m365.removeTenant')}
										disabled={action.pending()}
										onClick={() => void handleRemove(tenant)}
									>
										<IconTrash size={20} />
									</button>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</Show>
			<InlineError message={error()} />
		</>
	)
}

/** The enabled M365 integration, if configured (global managers only). */
function useM365(): () => IntegrationJson | undefined {
	const [integrations] = createRowsFor(() => canGlobal('integrations.manage'), fetch_integrations)
	return () =>
		canGlobal('integrations.manage')
			? (integrations() ?? []).find((i) => i.provider === 'm365' && i.enabled)
			: undefined
}

/**
 * Card on a conex tenant: the Entra tenant it is connected to, or the
 * admin consent link and a manual connect for consent given another way.
 */
export function M365TenantCard(props: { tenantId: number }): JSX.Element {
	const m365 = useM365()
	const [error, setError] = createSignal<string | null>(null)
	const [consent, setConsent] = createSignal<M365ConsentLinkJson | null>(null)
	const [manual, setManual] = createSignal('')
	const [copied, setCopied] = createSignal(false)
	const action = useAction(setError)
	const [status] = createRecord(
		() => (m365() ? props.tenantId : null),
		(tenant: number) => fetch_tenant_integration('m365', tenant),
		setError,
	)
	const [consented] = createRowsFor(() => m365() !== undefined, fetch_m365_tenants, setError)
	const link = (): TenantLink | null => status()?.links[0] ?? null
	const entra = (): M365TenantJson | undefined =>
		consented()?.find((row) => row.ms_tenant_id === link()?.link.external_id)

	async function handleConsentLink(): Promise<void> {
		setCopied(false)
		setError(null)
		const res = await fetch_m365_consent_link(props.tenantId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setConsent(res.value)
	}

	async function handleCopy(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
		} catch {
			setError(t('m365.copyFailed'))
		}
	}

	async function handleConnect(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const value = manual().trim()
		if (value === '') {
			return
		}
		if (await action.run(() => connect_m365_tenant(props.tenantId, value))) {
			setManual('')
			setConsent(null)
		}
	}

	async function handleDisconnect(): Promise<void> {
		const current = link()
		if (!current || !window.confirm(t('m365.confirmDisconnect'))) {
			return
		}
		await action.run(() => unlink_external('m365', current.link.id))
	}

	return (
		<Show when={m365()}>
			<section class="card" aria-labelledby="tenant-m365">
				<div class="card-header">
					<h3 id="tenant-m365">{t('provider.m365')}</h3>
				</div>
				<Show
					when={link()}
					fallback={
						<>
							<p>{t('m365.notConnected')}</p>
							<div class="form-actions">
								<button type="button" onClick={() => void handleConsentLink()}>
									{t('m365.createConsentLink')}
								</button>
							</div>
							<Show when={consent()}>
								{(current: () => M365ConsentLinkJson) => (
									<div>
										<p>
											<a
												href={current().url}
												target="_blank"
												rel="noopener noreferrer"
											>
												{t('m365.openConsentLink')}
											</a>{' '}
											<button
												type="button"
												class="btn-small"
												onClick={() => void handleCopy(current().url)}
											>
												<IconLabel icon={IconCopy}>
													{copied()
														? t('m365.copied')
														: t('m365.copyConsentLink')}
												</IconLabel>
											</button>
										</p>
										<Hint>
											{t('m365.consentLinkHint', {
												date: formatTime(current().expires_at),
												uri: current().redirect_uri,
											})}
										</Hint>
									</div>
								)}
							</Show>
							<form onSubmit={(e: SubmitEvent) => void handleConnect(e)}>
								<TextField
									id={`m365-manual-${props.tenantId}`}
									label={t('m365.manualConnect')}
									placeholder="contoso.onmicrosoft.com"
									maxLength={253}
									autocomplete="off"
									value={manual()}
									onInput={setManual}
									hint={<Hint>{t('m365.manualConnectHint')}</Hint>}
								/>
								<div class="form-actions">
									<button
										type="submit"
										disabled={action.pending() || manual().trim() === ''}
									>
										{action.pending() ? t('m365.checking') : t('m365.check')}
									</button>
								</div>
							</form>
						</>
					}
				>
					{(current: () => TenantLink) => (
						<>
							<dl class="detail-grid">
								<dt>{t('m365.entraTenant')}</dt>
								<dd>
									{current().external?.name ?? current().link.external_id}{' '}
									<small class="text-muted">{current().link.external_id}</small>
								</dd>
								<Show when={entra()?.default_domain}>
									<dt>{t('m365.defaultDomain')}</dt>
									<dd>{entra()?.default_domain}</dd>
								</Show>
								<Show when={entra()}>
									{(row: () => M365TenantJson) => (
										<>
											<dt>{t('integration.lastSync')}</dt>
											<dd>
												<TenantFetchState tenant={row()} />
											</dd>
										</>
									)}
								</Show>
							</dl>
							<div class="form-actions">
								<button
									type="button"
									class="btn-danger"
									disabled={action.pending()}
									onClick={() => void handleDisconnect()}
								>
									<IconLabel icon={IconUnlink}>{t('m365.disconnect')}</IconLabel>
								</button>
							</div>
						</>
					)}
				</Show>
				<InlineError message={error()} />
			</section>
		</Show>
	)
}
