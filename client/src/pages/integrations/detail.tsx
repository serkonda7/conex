import { IconRefresh } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import {
	fetch_integration,
	type IntegrationJson,
	run_sync,
	update_integration,
} from '../../api/integrations'
import { Empty, InlineError, Loading } from '../../components/feedback'
import type { RowMenuAction } from '../../components/list_page'
import { t } from '../../i18n'
import { providerDescription, providerLabel } from '../../i18n/labels'
import { createRecord, useAction } from '../../lib/resource'
import { usePageMeta } from '../../lib/router'
import { can, canGlobal, sessionTenantId } from '../../lib/session'
import { contextTenantId } from '../../lib/tenant_context'
import { IntegrationDetailHeader } from './detail_parts'
import { IntegrationModeBanner, providerStatus } from './integration_card'
import { ProviderSettings } from './settings'

/**
 * /integrations/:id — detail page of one provider (design decision 0006): header with
 * status, Enabled switch and "Sync now", then the settings. The consistency report
 * has its own page (/integrations/report); linking objects happens on the
 * cross-integration matching page. "Sync now" follows the tenant selector.
 */
export function IntegrationDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [integration, { mutate }] = createRecord(() => props.id, fetch_integration, setError)

	usePageMeta(() => ({
		name: integration() ? providerLabel(integration()?.provider ?? '') : undefined,
	}))

	const sync = useAction(setError)
	const toggle = useAction(setError)

	async function handleToggle(enabled: boolean): Promise<void> {
		const row = integration()
		if (!row) {
			return
		}
		await toggle.run(async () => {
			const res = await update_integration(row.provider, { provider: row.provider, enabled })
			if (Result.isOk(res)) {
				mutate(res.value)
			}
			return res
		})
	}

	async function handleSync(clean = false): Promise<void> {
		const row = integration()
		if (!row || sync.pending()) {
			return
		}
		if (
			clean &&
			!window.confirm(t('integration.confirmFullSync', { name: providerLabel(row.provider) }))
		) {
			return
		}
		const tenant = sessionTenantId() ?? contextTenantId()
		await sync.run(() => run_sync(row.provider, tenant ?? undefined, clean))
	}

	const menuActions = (): RowMenuAction[] =>
		canGlobal('integrations.manage')
			? [
					{
						label: t('integration.forceFullSync'),
						icon: IconRefresh,
						onSelect: (): void => void handleSync(true),
					},
				]
			: []

	return (
		<div class="integration-detail">
			<IntegrationModeBanner />
			<Show
				when={!integration.loading}
				fallback={<Loading message={t('integration.loadingOne')} />}
			>
				<Show when={integration()} fallback={<Empty message={t('integration.notFound')} />}>
					{(row: () => IntegrationJson): JSX.Element => (
						<>
							<IntegrationDetailHeader
								name={providerLabel(row().provider)}
								description={providerDescription(row().provider)}
								configured
								status={providerStatus(row(), sync.pending())}
								lastSyncFailed={row().last_sync?.state === 'error'}
								lastRun={row().last_sync}
								connectionError={row().last_error}
								manageable={can('integrations.manage')}
								enabled={row().enabled}
								toggling={toggle.pending()}
								onToggle={(enabled: boolean) => void handleToggle(enabled)}
								syncing={sync.pending() || row().last_sync?.state === 'running'}
								onSync={() => void handleSync()}
								menuActions={menuActions()}
							/>
							<InlineError message={error()} />
							{/* Not keyed: a refetch after a sync or toggle must not reset typed values. */}
							<ProviderSettings integration={row()} />
						</>
					)}
				</Show>
			</Show>
		</div>
	)
}
