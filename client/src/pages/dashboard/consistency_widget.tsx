import { FINDING_KINDS, type FindingKind } from 'shared/src/schemas'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import {
	fetch_integration_report,
	fetch_integrations,
	type IntegrationJson,
} from '../../api/integrations'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { t } from '../../i18n'
import { findingKindLabel, providerLabel } from '../../i18n/labels'
import { createRecord, createRowsFor } from '../../lib/resource'
import { can } from '../../lib/session'
import { tenantContextFilters } from '../../lib/tenant_context'
import { formatTime } from '../../lib/time'

interface FindingCount {
	kind: FindingKind
	count: number
}

/** Finding counts of one integration's report in the tenant context. */
function IntegrationSummary(props: {
	integration: IntegrationJson
	on_error: (message: string | null) => void
}): JSX.Element {
	const reportHref = (): string => `/integrations/${props.integration.id}`
	const [report] = createRecord(
		() => ({ provider: props.integration.provider, ...tenantContextFilters() }),
		(s) => fetch_integration_report(s.provider, s),
		props.on_error,
	)
	const counts = createMemo((): FindingCount[] => {
		const out = new Map<FindingKind, number>()
		for (const f of report()?.findings ?? []) {
			out.set(f.kind, (out.get(f.kind) ?? 0) + 1)
		}
		return FINDING_KINDS.filter((kind) => out.has(kind)).map((kind) => ({
			kind,
			count: out.get(kind) ?? 0,
		}))
	})

	const columns: DataTableColumn<FindingCount>[] = [
		{
			key: 'kind',
			label: t('integration.finding'),
			getValue: (c: FindingCount): JSX.Element => (
				<a href={`${reportHref()}?kind=${c.kind}`}>{findingKindLabel(c.kind)}</a>
			),
		},
		{
			key: 'count',
			label: t('dashboard.findingCount'),
			getValue: (c: FindingCount): number => c.count,
		},
	]

	return (
		<div>
			<h4>{providerLabel(props.integration.provider)}</h4>
			<p class="text-muted">
				{report()?.synced_at
					? t('integration.syncedAt', { time: formatTime(report()?.synced_at ?? 0) })
					: t('integration.neverSynced')}
			</p>
			<DataTable
				rows={counts}
				getRowId={(c: FindingCount): string => c.kind}
				columns={columns}
				loading={() => report.loading}
				loadingContent={<Loading message={t('integration.loadingReport')} />}
				emptyContent={<Empty message={t('integration.noFindings')} />}
			/>
			<p>
				<a href={reportHref()}>{t('integration.openReport')}</a>
			</p>
		</div>
	)
}

/**
 * Dashboard card with the finding counts of every enabled integration's
 * consistency report, each linking to the report filtered by that kind.
 * Integrations are only listed for `integrations.manage` (as is the report
 * page), so the card stays hidden for everyone else.
 */
export function ConsistencyWidget(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [integrations] = createRowsFor(
		() => can('integrations.manage'),
		fetch_integrations,
		setError,
	)
	const enabled = (): IntegrationJson[] => (integrations() ?? []).filter((i) => i.enabled)

	return (
		<Show when={enabled().length > 0}>
			<section class="card dashboard-widget" aria-labelledby="dashboard-consistency">
				<h3 id="dashboard-consistency">{t('dashboard.consistency')}</h3>
				<For each={enabled()}>
					{(integration: IntegrationJson): JSX.Element => (
						<IntegrationSummary integration={integration} on_error={setError} />
					)}
				</For>
				<InlineError message={error()} />
			</section>
		</Show>
	)
}
