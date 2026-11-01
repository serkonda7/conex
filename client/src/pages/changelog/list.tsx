import type { ChangeAction, ChangeObjectType } from 'shared/src/schemas'
import { createSignal, type JSX } from 'solid-js'
import { fetch_changelog, type ObjectChangeJson } from '../../api/changelog'
import { type DataTableColumn, FilterTable } from '../../components/data_table'
import { Empty, InlineError } from '../../components/feedback'
import { ListLoading, useListFilters, useQueryFilter } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { changeActionOptions, changeObjectLabel, changeObjectOptions } from '../../i18n/labels'
import { usePagedList } from '../../lib/paged_list'
import { parseId } from '../../lib/router'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'
import { formatTime } from '../../lib/time'
import { ChangeActionBadge, ChangedObjectLink, changeUser } from './common'

/**
 * /changelog — NetBox-style history of inventory changes (newest first),
 * narrowed by the tenant context (or `?tenant=<id>`). Searchable by object name or user and
 * filterable by action and object type; each entry links to its diff.
 */
export function ChangelogPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [filterTenant] = useQueryFilter('tenant')
	const [search, setSearch] = createSignal('')
	const [action, setAction] = createSignal<ChangeAction[]>([])
	const [objectType, setObjectType] = createSignal<ChangeObjectType[]>([])
	const filters = useListFilters<ObjectChangeJson>({
		search,
		setSearch,
		filters: () => [
			{
				key: 'action',
				label: t('changelog.action'),
				options: changeActionOptions(),
				value: action,
				onChange: (value: string[]): void => {
					setAction(value as ChangeAction[])
				},
			},
			{
				key: 'object_type',
				label: t('common.type'),
				options: changeObjectOptions(),
				value: objectType,
				onChange: (value: string[]): void => {
					setObjectType(value as ChangeObjectType[])
				},
			},
		],
	})

	const changes = usePagedList({
		query: () => ({
			search: search(),
			action: action().length > 0 ? action() : undefined,
			object_type: objectType().length > 0 ? objectType() : undefined,
			...tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		fetch: fetch_changelog,
		setError,
	})

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
			label: t('entity.user.one'),
			getValue: (c: ObjectChangeJson): string => changeUser(c),
		},
		{
			key: 'action',
			label: t('changelog.action'),
			getValue: (c: ObjectChangeJson): JSX.Element => <ChangeActionBadge action={c.action} />,
		},
		{
			key: 'object_type',
			label: t('common.type'),
			getValue: (c: ObjectChangeJson): string => changeObjectLabel(c.object_type),
		},
		{
			key: 'object',
			label: t('changelog.object'),
			getValue: (c: ObjectChangeJson): JSX.Element => <ChangedObjectLink change={c} />,
		},
	]

	const emptyText = (): string =>
		search()
			? t('list.noMatch', { noun: tp('noun.change', 2), search: search() })
			: action() || objectType() || filterTenant() !== '' || tenantContext().kind !== 'all'
				? t('list.noMatchFilters', { noun: tp('noun.change', 2) })
				: t('changelog.empty')

	return (
		<div>
			<div class="page-header">
				<h2>{t('entity.changelog')}</h2>
			</div>

			<FilterTable
				rows={changes.rows}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				savedFiltersKey="changelog"
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: tp('noun.change', 2) })}
				getRowId={(c: ObjectChangeJson): number => c.id}
				columns={columns}
				pagination={changes.pagination}
				onPaginationChange={changes.onPaginationChange}
				loading={() => changes.page.loading}
				loadingContent={<ListLoading rows={changes.rows()} noun={tp('noun.change', 2)} />}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<InlineError message={error()} />
		</div>
	)
}
