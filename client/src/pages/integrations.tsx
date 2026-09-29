import { IconPencil, IconRefresh, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { INTEGRATION_PROVIDERS } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	delete_integration,
	fetch_integrations,
	type IntegrationJson,
	type IntegrationProvider,
	start_sync,
	wait_for_sync,
} from '../api_integrations'
import { InlineError, Loading } from '../components/feedback'
import { t, tp } from '../i18n'
import { providerLabel, syncStateLabel } from '../i18n/labels'
import { goTo, navigate } from '../router'
import { canWrite, canWriteGlobal, isAdmin } from '../session'
import { formatTime } from '../util/time'

/**
 * /integrations — one card per provider: connection state, last sync and
 * the sync / report / edit actions. Admins set up providers here.
 */
export function IntegrationsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [syncing, setSyncing] = createSignal<IntegrationProvider | null>(null)

	const [integrations, { refetch }] = createResource(async () => {
		const res = await fetch_integrations()
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value
	})

	const configured = (provider: IntegrationProvider): IntegrationJson | undefined =>
		integrations()?.find((i) => i.provider === provider)

	async function handleSync(provider: IntegrationProvider, clean = false): Promise<void> {
		if (
			clean &&
			!window.confirm(t('integration.confirmFullSync', { name: providerLabel(provider) }))
		) {
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

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.integration', 2)}</h2>
			</div>
			<p class="page-subtitle">{t('integration.intro')}</p>
			<Show
				when={!integrations.loading || integrations() !== undefined}
				fallback={
					<Loading message={t('list.loading', { noun: tp('noun.integration', 2) })} />
				}
			>
				<For each={INTEGRATION_PROVIDERS}>
					{(provider: IntegrationProvider): JSX.Element => (
						<section class="card" aria-label={providerLabel(provider)}>
							<div class="page-header">
								<h3>{providerLabel(provider)}</h3>
								<Show
									when={configured(provider)}
									fallback={
										<Show when={isAdmin()}>
											<button
												type="button"
												class="btn-add"
												onClick={() => navigate('/integrations/add')}
											>
												{t('integration.setUp')}
											</button>
										</Show>
									}
								>
									{(integration: () => IntegrationJson): JSX.Element => (
										<div class="form-actions">
											<Show when={canWrite()}>
												<button
													type="button"
													disabled={
														syncing() !== null ||
														integration().last_sync?.state === 'running'
													}
													onClick={() => void handleSync(provider)}
												>
													<span aria-hidden="true" class="app-nav-icon">
														<IconRefresh size={14} />
													</span>{' '}
													{syncing() === provider ||
													integration().last_sync?.state === 'running'
														? t('integration.syncing')
														: t('integration.syncNow')}
												</button>
												<Show when={canWriteGlobal()}>
													<button
														type="button"
														disabled={
															syncing() !== null ||
															integration().last_sync?.state ===
																'running'
														}
														onClick={() =>
															void handleSync(provider, true)
														}
													>
														<span
															aria-hidden="true"
															class="app-nav-icon"
														>
															<IconRefresh size={14} />
														</span>{' '}
														{syncing() === provider ||
														integration().last_sync?.state === 'running'
															? t('integration.syncing')
															: t('integration.forceFullSync')}
													</button>
												</Show>
											</Show>
											<Show when={isAdmin()}>
												<button
													type="button"
													onClick={() =>
														navigate(
															`/integrations/${integration().id}/edit`,
														)
													}
												>
													<span aria-hidden="true" class="app-nav-icon">
														<IconPencil size={14} />
													</span>{' '}
													{t('common.edit')}
												</button>
												<button
													type="button"
													class="btn-danger"
													onClick={() => void handleDelete(integration())}
												>
													<span aria-hidden="true" class="app-nav-icon">
														<IconTrash size={14} />
													</span>{' '}
													{t('common.delete')}
												</button>
											</Show>
										</div>
									)}
								</Show>
							</div>
							<Show
								when={configured(provider)}
								fallback={<p class="empty">{t('integration.notConfigured')}</p>}
							>
								{(integration: () => IntegrationJson): JSX.Element => (
									<>
										<dl class="detail-grid">
											<dt>{t('integration.baseUrl')}</dt>
											<dd>{integration().base_url}</dd>
											<dt>{t('integration.username')}</dt>
											<dd>{integration().username}</dd>
											<dt>{t('common.status')}</dt>
											<dd>
												<Show
													when={integration().enabled}
													fallback={t('integration.disabled')}
												>
													<Show
														when={integration().last_error}
														fallback={
															integration().last_login_ok_at !== null
																? t('integration.connectedAt', {
																		time: formatTime(
																			integration()
																				.last_login_ok_at ??
																				0,
																		),
																	})
																: '—'
														}
													>
														<span class="text-danger">
															{integration().last_error}
														</span>
													</Show>
												</Show>
											</dd>
											<dt>{t('integration.lastSync')}</dt>
											<dd>
												<Show
													when={integration().last_sync}
													fallback={t('integration.neverSynced')}
												>
													{(
														run: () => NonNullable<
															IntegrationJson['last_sync']
														>,
													) => (
														<>
															{syncStateLabel(run().state)} ·{' '}
															{formatTime(
																run().finished_at ??
																	run().started_at,
															)}
															<Show when={run().state === 'ok'}>
																{' · '}
																{t('integration.syncCounts', {
																	tenants: run().counts.tenants,
																	devices: run().counts.devices,
																	linked: run().counts
																		.auto_linked,
																})}
															</Show>
															<Show when={run().error}>
																{' · '}
																<span class="text-danger">
																	{run().error}
																</span>
															</Show>
														</>
													)}
												</Show>
											</dd>
										</dl>
										<p>
											<a
												href={`/integrations/${integration().id}`}
												onClick={(e: MouseEvent): void =>
													goTo(e, `/integrations/${integration().id}`)
												}
											>
												{t('integration.openReport')}
											</a>
										</p>
									</>
								)}
							</Show>
						</section>
					)}
				</For>
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
