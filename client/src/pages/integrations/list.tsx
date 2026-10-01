import { IconPencil, IconRefresh, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { INTEGRATION_PROVIDERS } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import {
	delete_integration,
	fetch_integrations,
	type IntegrationJson,
	type IntegrationProvider,
	type SyncRunJson,
	start_sync,
	wait_for_sync,
} from '../../api/integrations'
import { InlineError, Loading } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { providerLabel, syncStateLabel } from '../../i18n/labels'
import { createRows } from '../../lib/resource'
import { navigate } from '../../lib/router'
import { can, canGlobal } from '../../lib/session'
import { formatTime } from '../../lib/time'

/** Login state: disabled, the last error, or when it last connected. */
function LoginStatus(props: { integration: IntegrationJson }): JSX.Element {
	const connected = (): string => {
		const at = props.integration.last_login_ok_at
		return at === null ? '—' : t('integration.connectedAt', { time: formatTime(at) })
	}
	return (
		<Show when={props.integration.enabled} fallback={t('integration.disabled')}>
			<Show when={props.integration.last_error} fallback={connected()}>
				<span class="text-danger">{props.integration.last_error}</span>
			</Show>
		</Show>
	)
}

/** State, time, error and counts of the last sync run. */
function SyncStatus(props: { run: SyncRunJson }): JSX.Element {
	return (
		<>
			<div>
				{syncStateLabel(props.run.state)}
				{' ('}
				{formatTime(props.run.finished_at ?? props.run.started_at)}
				{')'}
				<Show when={props.run.error}>
					{' · '}
					<span class="text-danger">{props.run.error}</span>
				</Show>
			</div>
			<Show when={props.run.state === 'ok'}>
				<div>
					{t('integration.syncCounts', {
						tenants: props.run.counts.tenants,
						devices: props.run.counts.devices,
					})}
				</div>
			</Show>
		</>
	)
}

/** Sync / full sync / edit / delete buttons of a configured provider. */
function IntegrationActions(props: {
	integration: IntegrationJson
	/** Provider currently syncing from this page, if any. */
	syncing: IntegrationProvider | null
	onSync: (clean: boolean) => void
	onDelete: () => void
}): JSX.Element {
	const running = (): boolean =>
		props.syncing === props.integration.provider ||
		props.integration.last_sync?.state === 'running'
	const busy = (): boolean =>
		props.syncing !== null || props.integration.last_sync?.state === 'running'
	return (
		<div class="form-actions">
			<Show when={can('integrations.manage')}>
				<button type="button" disabled={busy()} onClick={() => props.onSync(false)}>
					<IconLabel icon={IconRefresh}>
						{running() ? t('integration.syncing') : t('integration.syncNow')}
					</IconLabel>
				</button>
				<Show when={canGlobal('integrations.manage')}>
					<button type="button" disabled={busy()} onClick={() => props.onSync(true)}>
						<IconLabel icon={IconRefresh}>
							{running() ? t('integration.syncing') : t('integration.forceFullSync')}
						</IconLabel>
					</button>
				</Show>
			</Show>
			<Show when={can('integrations.manage')}>
				<button
					type="button"
					onClick={() => navigate(`/integrations/${props.integration.id}/edit`)}
				>
					<IconLabel icon={IconPencil}>{t('common.edit')}</IconLabel>
				</button>
				<button type="button" class="btn-danger" onClick={() => props.onDelete()}>
					<IconLabel icon={IconTrash}>{t('common.delete')}</IconLabel>
				</button>
			</Show>
		</div>
	)
}

/** Connection and last-sync details of a configured provider. */
function IntegrationDetails(props: { integration: IntegrationJson }): JSX.Element {
	return (
		<>
			<dl class="detail-grid">
				<dt>{t('integration.baseUrl')}</dt>
				<dd>{props.integration.base_url}</dd>
				<dt>{t('integration.username')}</dt>
				<dd>{props.integration.username}</dd>
				<dt>{t('integration.lastLogin')}</dt>
				<dd>
					<LoginStatus integration={props.integration} />
				</dd>
				<dt>{t('integration.lastSync')}</dt>
				<dd>
					<Show
						when={props.integration.last_sync}
						fallback={t('integration.neverSynced')}
					>
						{(run: () => SyncRunJson) => <SyncStatus run={run()} />}
					</Show>
				</dd>
			</dl>
			<p>
				<a href={`/integrations/${props.integration.id}`}>{t('integration.openReport')}</a>
			</p>
		</>
	)
}

/**
 * /integrations — one card per provider: connection state, last sync and
 * the sync / report / edit actions. Admins set up providers here.
 */
export function IntegrationsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [syncing, setSyncing] = createSignal<IntegrationProvider | null>(null)
	const [integrations, { refetch }] = createRows(fetch_integrations, setError)

	const configured = (provider: IntegrationProvider): IntegrationJson | undefined =>
		integrations()?.find((i) => i.provider === provider)

	async function handleSync(provider: IntegrationProvider, clean: boolean): Promise<void> {
		const name = providerLabel(provider)
		if (clean && !window.confirm(t('integration.confirmFullSync', { name }))) {
			return
		}
		setError(null)
		setSyncing(provider)
		const started = await start_sync(provider, undefined, clean)
		if (Result.isError(started)) {
			setSyncing(null)
			setError(started.error.message)
			return
		}
		// Show the registered run while waiting for it.
		void refetch()
		const done = await wait_for_sync(provider, started.value)
		setSyncing(null)
		if (Result.isError(done)) {
			setError(done.error.message)
		}
		void refetch()
	}

	async function handleDelete(integration: IntegrationJson): Promise<void> {
		const name = providerLabel(integration.provider)
		if (!window.confirm(t('integration.confirmDelete', { name }))) {
			return
		}
		setError(null)
		const res = await delete_integration(integration.provider)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	const card = (provider: IntegrationProvider): JSX.Element => (
		<section class="card" aria-label={providerLabel(provider)}>
			<div class="page-header">
				<h3>{providerLabel(provider)}</h3>
				<Show
					when={configured(provider)}
					fallback={
						<Show when={can('integrations.manage')}>
							<button
								type="button"
								class="btn-add"
								onClick={(): void => navigate('/integrations/add')}
							>
								{t('integration.setUp')}
							</button>
						</Show>
					}
				>
					{(integration: () => IntegrationJson): JSX.Element => (
						<IntegrationActions
							integration={integration()}
							syncing={syncing()}
							onSync={(clean: boolean): void => void handleSync(provider, clean)}
							onDelete={(): void => void handleDelete(integration())}
						/>
					)}
				</Show>
			</div>
			<Show
				when={configured(provider)}
				fallback={<p class="empty">{t('integration.notConfigured')}</p>}
			>
				{(integration: () => IntegrationJson): JSX.Element => (
					<IntegrationDetails integration={integration()} />
				)}
			</Show>
		</section>
	)

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.integration', 2)}</h2>
			</div>
			<Show
				when={!integrations.loading || integrations() !== undefined}
				fallback={
					<Loading message={t('list.loading', { noun: tp('noun.integration', 2) })} />
				}
			>
				<For each={INTEGRATION_PROVIDERS}>{card}</For>
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
