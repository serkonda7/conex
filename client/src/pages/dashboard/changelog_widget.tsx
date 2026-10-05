import { createSignal, type JSX } from 'solid-js'
import { fetch_changelog, type ObjectChangeJson } from '../../api/changelog'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { changeObjectLabel } from '../../i18n/labels'
import { createRowsFor } from '../../lib/resource'
import { type TenantContextFilters, tenantContextFilters } from '../../lib/tenant_context'
import { formatTime } from '../../lib/time'
import { ChangeActionBadge, ChangedObjectLink, changeUser } from '../changelog/common'

/** Changes shown in the widget; the full history lives on /changelog. */
const RECENT_LIMIT = 10

/**
 * Dashboard card with the newest changes in the tenant context and a link
 * to the full changelog.
 */
export function ChangelogWidget(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [changes] = createRowsFor(
		(): TenantContextFilters => tenantContextFilters(),
		(context: TenantContextFilters) => fetch_changelog({ limit: RECENT_LIMIT, ...context }),
		setError,
	)

	const columns: DataTableColumn<ObjectChangeJson>[] = [
		{
			key: 'time',
			label: t('changelog.time'),
			getValue: (c: ObjectChangeJson): JSX.Element => (
				<a href={`/changelog/${c.id}`}>{formatTime(c.created_at)}</a>
			),
		},
		{
			key: 'user',
			label: t('changelog.user'),
			getValue: (c: ObjectChangeJson): string => changeUser(c),
		},
		{
			key: 'action',
			label: t('changelog.action'),
			getValue: (c: ObjectChangeJson): JSX.Element => <ChangeActionBadge action={c.action} />,
		},
		{
			key: 'object',
			label: t('changelog.object'),
			getValue: (c: ObjectChangeJson): JSX.Element => (
				<span>
					<ChangedObjectLink change={c} />{' '}
					<span class="text-muted">({changeObjectLabel(c.object_type)})</span>
				</span>
			),
		},
	]

	return (
		<section class="card dashboard-widget" aria-labelledby="dashboard-changelog">
			<h3 id="dashboard-changelog">{tp('entity.changelog', 1)}</h3>
			<DataTable
				rows={() => changes() ?? []}
				getRowId={(c: ObjectChangeJson): number => c.id}
				columns={columns}
				loading={() => changes.loading}
				loadingContent={
					<Loading message={t('list.loading', { noun: tp('noun.change', 2) })} />
				}
				emptyContent={<Empty message={t('changelog.empty')} />}
			/>
			<p>
				<a href="/changelog">{t('common.viewIn', { target: tp('entity.changelog', 1) })}</a>
			</p>
			<InlineError message={error()} />
		</section>
	)
}
