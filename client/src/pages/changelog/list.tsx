import { Result } from 'better-result'
import type { ChangeAction, ChangeObjectType } from 'shared/src/schemas'
import { createResource, createSignal, type JSX } from 'solid-js'
import { fetch_changelog, type ObjectChangeJson } from '../../api/changelog'
import { type DataTableColumn, FilterTable } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import {
	ListRangeStatus,
	useDebouncedSearch,
	useListFilters,
	useQueryFilter,
} from '../../components/list_page'
import { t, tp } from '../../i18n'
import { changeActionOptions, changeObjectLabel, changeObjectOptions } from '../../i18n/labels'
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
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
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

	const [changes] = createResource(
		() => ({
			search: debouncedSearch(),
			action: action(),
			objectType: objectType(),
			context: tenantContextFilters(parseId(filterTenant()) ?? undefined),
		}),
		async (q) => {
			setError(null)
			const res = await fetch_changelog({
				search: q.search,
				action: q.action.length > 0 ? q.action : undefined,
				object_type: q.objectType.length > 0 ? q.objectType : undefined,
				...q.context,
			})
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
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
		debouncedSearch()
			? t('list.noMatch', { noun: tp('noun.change', 2), search: debouncedSearch() })
			: action() || objectType() || filterTenant() !== '' || tenantContext().kind !== 'all'
				? t('list.noMatchFilters', { noun: tp('noun.change', 2) })
				: t('changelog.empty')

	return (
		<div>
			<div class="page-header">
				<h2>{t('entity.changelog')}</h2>
			</div>

			<FilterTable
				rows={() => changes()?.items ?? []}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				savedFiltersKey="changelog"
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: tp('noun.change', 2) })}
				getRowId={(c: ObjectChangeJson): number => c.id}
				columns={columns}
				loading={() => changes.loading}
				loadingContent={
					<Loading message={t('list.loading', { noun: tp('noun.change', 2) })} />
				}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<ListRangeStatus shown={changes()?.items.length ?? 0} total={changes()?.total ?? 0} />

			<InlineError message={error()} />
		</div>
	)
}
