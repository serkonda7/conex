import { IconLayoutGrid, IconList, IconPlugConnected, IconPlus } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { INTEGRATION_PROVIDERS } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { fetch_calendar_sync_config } from '../../api/calendar_sync'
import {
	fetch_integrations,
	type IntegrationJson,
	type IntegrationProvider,
	run_sync,
} from '../../api/integrations'
import { InlineError, Loading } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { providerDescription, providerLabel } from '../../i18n/labels'
import { providerIcon } from '../../lib/icons'
import { createRecord, createRows } from '../../lib/resource'
import { navigate } from '../../lib/router'
import { can, canGlobal } from '../../lib/session'
import { CalendarSyncCard, calendarNeedsAttention } from './calendar_sync'
import {
	IntegrationCard,
	type IntegrationLayout,
	IntegrationModeBanner,
	type IntegrationStatus,
	integrationLayout,
	LastRunError,
	LastRunTime,
	providerStatus,
	StatusPill,
	SyncIconButton,
	setIntegrationLayout,
	WarningPill,
} from './integration_card'

/** Enabled, but the login or the latest sync failed. */
function needsAttention(integration: IntegrationJson): boolean {
	return (
		integration.enabled &&
		(integration.last_error !== null || integration.last_sync?.state === 'error')
	)
}

function detailHref(integration: IntegrationJson): string {
	return `/integrations/${integration.id}`
}

/** Setup page of one provider, preselected so its form fits it. */
function addHref(provider: IntegrationProvider): string {
	return `/integrations/add?provider=${provider}`
}

/** Card of one provider, set up or not; it opens the detail page or the setup. */
function ProviderCard(props: {
	provider: IntegrationProvider
	integration: IntegrationJson | undefined
	/** Provider currently syncing from this page, if any. */
	syncing: IntegrationProvider | null
	onSync: (clean: boolean) => void
}): JSX.Element {
	const shared = {
		get name(): string {
			return providerLabel(props.provider)
		},
		get description(): string {
			return providerDescription(props.provider)
		},
		icon: providerIcon(props.provider),
	}
	return (
		<Show
			when={props.integration}
			fallback={
				<IntegrationCard
					{...shared}
					href={can('integrations.manage') ? addHref(props.provider) : undefined}
					action={
						<Show when={can('integrations.manage')}>
							<button
								type="button"
								class="integration-card-btn"
								onClick={() => navigate(addHref(props.provider))}
							>
								<IconLabel icon={IconPlus}>{t('integration.setUp')}</IconLabel>
							</button>
						</Show>
					}
				/>
			}
		>
			{(integration: () => IntegrationJson): JSX.Element => {
				const running = (): boolean =>
					props.syncing === props.provider || integration().last_sync?.state === 'running'
				const busy = (): boolean => props.syncing !== null || running()
				const status = (): IntegrationStatus => providerStatus(integration(), running())
				const neverSynced = (): boolean => integration().last_sync === null
				return (
					<IntegrationCard
						{...shared}
						href={detailHref(integration())}
						tone={
							status() === 'error'
								? 'error'
								: status() === 'disabled'
									? 'disabled'
									: undefined
						}
						status={
							<>
								<StatusPill status={status()} />
								<Show
									when={
										integration().enabled &&
										integration().last_sync?.state === 'error'
									}
								>
									<WarningPill>{t('integration.lastSyncFailed')}</WarningPill>
								</Show>
								<LastRunTime run={integration().last_sync} />
							</>
						}
						details={
							<>
								<Show when={integration().enabled && integration().last_error}>
									<p class="integration-error">{integration().last_error}</p>
								</Show>
								<LastRunError
									run={integration().last_sync}
									shown={integration().enabled ? integration().last_error : null}
								/>
							</>
						}
						action={
							<Show when={can('integrations.write')}>
								<Show
									when={!neverSynced() || running()}
									fallback={
										<button
											type="button"
											class="integration-card-btn"
											classList={{ 'btn-add': status() === 'connected' }}
											disabled={busy() || !integration().enabled}
											onClick={() => props.onSync(false)}
										>
											{t('integration.runFirstSync')}
										</button>
									}
								>
									<SyncIconButton
										syncing={running()}
										disabled={busy() || !integration().enabled}
										onClick={() => props.onSync(false)}
									/>
								</Show>
							</Show>
						}
					/>
				)
			}}
		</Show>
	)
}

/** Grid / list switch of the integrations page. */
function LayoutToggle(): JSX.Element {
	const option = (
		value: IntegrationLayout,
		label: string,
		icon: typeof IconList,
	): JSX.Element => (
		<button
			type="button"
			class="integrations-layout-option"
			aria-label={label}
			title={label}
			aria-pressed={integrationLayout() === value}
			onClick={(): void => setIntegrationLayout(value)}
		>
			<Dynamic component={icon} size={16} />
		</button>
	)
	return (
		<fieldset class="integrations-layout-toggle" aria-label={t('integration.layout')}>
			{option('grid', t('integration.layoutGrid'), IconLayoutGrid)}
			{option('list', t('integration.layoutList'), IconList)}
		</fieldset>
	)
}

/**
 * /integrations — every integration, set up or not, as a card in one grid,
 * with a grid / list switch (remembered per browser) and a
 * connected / needs-attention summary in the header. A card opens the detail
 * page (an unconfigured one its setup), never a form in place; it has no ⋯
 * menu and no remove action (design decision 0006). Admins set up providers here.
 * Outside `live` mode a banner says the integrations are mocked or offline.
 */
export function IntegrationsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [syncing, setSyncing] = createSignal<IntegrationProvider | null>(null)
	const [integrations] = createRows(fetch_integrations, setError)

	const configured = (provider: IntegrationProvider): IntegrationJson | undefined =>
		integrations()?.find((i) => i.provider === provider)

	// The calendar sync builds on the TANSS credentials; its card shares this cache entry.
	const calendarVisible = (): boolean => canGlobal('integrations.manage')
	const [calendar] = createRecord(
		() => (calendarVisible() && configured('tanss') ? true : null),
		fetch_calendar_sync_config,
		setError,
	)

	const connectedCount = (): number =>
		(integrations() ?? []).length + (calendar()?.configured ? 1 : 0)
	const errorCount = (): number =>
		(integrations() ?? []).filter(needsAttention).length +
		(calendarNeedsAttention(calendar() ?? null) ? 1 : 0)
	const okCount = (): number => connectedCount() - errorCount()

	async function handleSync(provider: IntegrationProvider, clean: boolean): Promise<void> {
		const name = providerLabel(provider)
		if (clean && !window.confirm(t('integration.confirmFullSync', { name }))) {
			return
		}
		setError(null)
		setSyncing(provider)
		const done = await run_sync(provider, undefined, clean)
		setSyncing(null)
		if (Result.isError(done)) {
			setError(done.error.message)
		}
	}

	return (
		<div
			class="integrations-page"
			classList={{ 'integrations-list': integrationLayout() === 'list' }}
		>
			<div class="integrations-header">
				<span class="page-header-icon" aria-hidden="true">
					<IconPlugConnected size={20} />
				</span>
				<h2>{tp('entity.integration', 2)}</h2>
				<div class="integrations-summary">
					<Show when={okCount() > 0}>
						<span>
							<span aria-hidden="true" class="integrations-summary-dot" />
							{t('integration.summaryOk', { count: okCount() })}
						</span>
					</Show>
					<Show when={errorCount() > 0}>
						<span>
							<span
								aria-hidden="true"
								class="integrations-summary-dot integrations-summary-dot-error"
							/>
							{t('integration.summaryError', { count: errorCount() })}
						</span>
					</Show>
				</div>
				<LayoutToggle />
			</div>
			<IntegrationModeBanner />
			<Show
				when={!integrations.loading || integrations() !== undefined}
				fallback={
					<Loading message={t('list.loading', { noun: tp('noun.integration', 2) })} />
				}
			>
				<div class="integration-grid">
					<For each={INTEGRATION_PROVIDERS}>
						{(provider: IntegrationProvider): JSX.Element => (
							<ProviderCard
								provider={provider}
								integration={configured(provider)}
								syncing={syncing()}
								onSync={(clean: boolean): void => void handleSync(provider, clean)}
							/>
						)}
					</For>
					<Show when={calendarVisible()}>
						<CalendarSyncCard blocked={!configured('tanss')} />
					</Show>
				</div>
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
