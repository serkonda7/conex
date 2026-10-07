import { Result } from 'better-result'
import type { ChangeAction, ChangeObjectType } from 'shared/src/schemas'
import { createResource, createSignal, For, type JSX } from 'solid-js'
import { fetch_changelog, type ObjectChangeJson } from '../../api/changelog'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { ListRangeStatus, ListSearchField, useDebouncedSearch } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { changeActionOptions, changeObjectLabel, changeObjectOptions } from '../../i18n/labels'
import { tenantContext, tenantContextFilters } from '../../lib/tenant_context'
import { formatTime } from '../../lib/time'
import { ChangeActionBadge, ChangedObjectLink, changeUser } from './common'

/**
 * /changelog — NetBox-style history of inventory changes (newest first),
 * narrowed by the tenant context. Searchable by object name or user and
 * filterable by action and object type; each entry links to its diff.
 */
export function ChangelogPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const { search, setSearch, debouncedSearch } = useDebouncedSearch()
	const [action, setAction] = createSignal<ChangeAction | ''>('')
	const [objectType, setObjectType] = createSignal<ChangeObjectType | ''>('')

	const [changes] = createResource(
		() => ({
			search: debouncedSearch(),
			action: action(),
			objectType: objectType(),
			context: tenantContextFilters(),
		}),
		async (q) => {
			setError(null)
			const res = await fetch_changelog({
				search: q.search,
				action: q.action || undefined,
				object_type: q.objectType || undefined,
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
			label: t('changelog.user'),
			getValue: (c: ObjectChangeJson): string => changeUser(c),
		},
		{
			key: 'action',
			label: t('changelog.action'),
			getValue: (c: ObjectChangeJson): JSX.Element => <ChangeActionBadge action={c.action} />,
		},
		{
			key: 'object_type',
			label: t('changelog.objectType'),
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
			: action() || objectType() || tenantContext().kind !== 'all'
				? t('list.noMatchFilters', { noun: tp('noun.change', 2) })
				: t('changelog.empty')

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.changelog', 1)}</h2>
			</div>

			<div class="toolbar-row">
				<ListSearchField
					label={t('list.searchLabel', { noun: tp('noun.change', 2) })}
					placeholder={t('changelog.searchPlaceholder')}
					value={search()}
					onInput={setSearch}
				/>
				<label>
					<span class="visually-hidden">{t('changelog.filterByAction')}</span>
					<select
						aria-label={t('changelog.filterByAction')}
						value={action()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setAction(e.currentTarget.value as ChangeAction | '')
						}}
					>
						<option value="">{t('changelog.allActions')}</option>
						<For each={changeActionOptions()}>
							{(o: { value: ChangeAction; label: string }): JSX.Element => (
								<option value={o.value}>{o.label}</option>
							)}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">{t('changelog.filterByType')}</span>
					<select
						aria-label={t('changelog.filterByType')}
						value={objectType()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }): void => {
							setObjectType(e.currentTarget.value as ChangeObjectType | '')
						}}
					>
						<option value="">{t('changelog.allTypes')}</option>
						<For each={changeObjectOptions()}>
							{(o: { value: ChangeObjectType; label: string }): JSX.Element => (
								<option value={o.value}>{o.label}</option>
							)}
						</For>
					</select>
				</label>
			</div>

			<DataTable
				rows={() => changes()?.items ?? []}
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
