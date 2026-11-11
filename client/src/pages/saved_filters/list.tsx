import type { ComboboxOption } from '@serkonda7/solid-components'
import { IconPencil } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { SavedFilterListQuery } from 'shared/src/types'
import { createSignal, For, type JSX, Show } from 'solid-js'
import {
	delete_saved_filter,
	fetch_all_saved_filters,
	type SavedFilterEntryJson,
	type SavedFilterJson,
	type SavedFilterPageJson,
	update_saved_filter,
} from '../../api/saved_filters'
import { routeSection } from '../../app/routes'
import { type DataTableColumn, FilterTable } from '../../components/data_table'
import { Empty, InlineError } from '../../components/feedback'
import { Hint, TextAreaField, TextField } from '../../components/form'
import {
	ListLoading,
	RowMenu,
	type RowMenuAnchor,
	useListFilters,
	useRowMenu,
} from '../../components/list_page'
import { Modal } from '../../components/modal'
import { MoreActionsButton } from '../../components/more_actions_button'
import { t, tp } from '../../i18n'
import { usePagedList } from '../../lib/paged_list'
import { useAction } from '../../lib/resource'
import { formatTime } from '../../lib/time'

/** Localized name of a table key (its list section), or the raw key for unknown tables. */
function tableLabel(table: string): string {
	const section = routeSection(`/${table}`)
	return section && section.path === table ? (section.navLabel?.() ?? section.noun(2)) : table
}

/** List page of a table key, when the key names a routed list. */
function tableHref(table: string): string | undefined {
	const section = routeSection(`/${table}`)
	return section && section.path === table && section.list ? `/${table}` : undefined
}

function rowKey(entry: SavedFilterEntryJson): string {
	return `${entry.table}/${entry.position}`
}

/** `key = value` lines of a filter; lists join with commas. */
function FilterValues(props: { values: SavedFilterJson['values'] }): JSX.Element {
	const pairs = (): [string, string][] =>
		Object.entries(props.values).flatMap(([key, value]): [string, string][] => {
			const text = Array.isArray(value) ? value.join(', ') : value
			return text === '' ? [] : [[key, text]]
		})
	return (
		<Show
			when={pairs().length > 0}
			fallback={<span class="text-muted">{t('savedFilter.noValues')}</span>}
		>
			<span class="saved-filter-values">
				<For each={pairs()}>
					{([key, text]: [string, string]): JSX.Element => (
						<code>
							{key}={text}
						</code>
					)}
				</For>
			</span>
		</Show>
	)
}

/** Parses the parameters textarea: an object of strings or string lists, else null. */
function parseValues(raw: string): SavedFilterJson['values'] | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return null
	}
	const values: SavedFilterJson['values'] = {}
	for (const [key, value] of Object.entries(parsed)) {
		if (typeof value === 'string') {
			values[key] = value
		} else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
			values[key] = value as string[]
		} else {
			return null
		}
	}
	return values
}

/**
 * Renames a saved filter or edits its raw parameters (NetBox-style JSON),
 * for values the table's own filter form cannot reach anymore (e.g. a
 * removed option).
 */
function EditSavedFilterDialog(props: {
	entry: SavedFilterEntryJson
	on_close: () => void
}): JSX.Element {
	const [name, setName] = createSignal(props.entry.name)
	const [params, setParams] = createSignal(JSON.stringify(props.entry.values, null, 2))
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const values = parseValues(params())
		if (values === null) {
			setError(t('savedFilter.invalidParameters'))
			return
		}
		const saved = await save.run(() =>
			update_saved_filter(props.entry, { name: name().trim(), values }),
		)
		if (saved) {
			props.on_close()
		}
	}

	return (
		<Modal
			title={t('savedFilter.editTitle', { name: props.entry.name })}
			on_close={props.on_close}
		>
			<form class="form-stacked" onSubmit={handleSave}>
				<TextField
					id="saved-filter-name"
					label={t('common.name')}
					required
					autofocus
					maxLength={200}
					value={name()}
					onInput={setName}
				/>
				<TextAreaField
					id="saved-filter-parameters"
					label={t('savedFilter.parameters')}
					rows={8}
					value={params()}
					onInput={setParams}
				/>
				<Hint>{t('savedFilter.parametersHint')}</Hint>
				<div class="modal-actions">
					<button type="submit" disabled={name().trim() === '' || save.pending()}>
						{save.pending() ? t('common.saving') : t('common.save')}
					</button>
					<button type="button" onClick={props.on_close}>
						{t('common.cancel')}
					</button>
				</div>
			</form>
			<InlineError message={error()} alert />
		</Modal>
	)
}

/**
 * /saved-filters — NetBox-style overview of the saved filters of every
 * list, shared by all users. Filters are created from a list's "Saved
 * filters" tab; here they are renamed, their parameters edited, or deleted.
 * Searchable by name and filterable by table.
 */
export function SavedFiltersPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [table, setTable] = createSignal<string[]>([])
	const [editing, setEditing] = createSignal<SavedFilterEntryJson | null>(null)
	const [tables, setTables] = createSignal<string[]>([])
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const entries = usePagedList({
		query: () => ({ search: search(), table: table().length > 0 ? table() : undefined }),
		// The response also names every table with saved filters, for the table filter.
		fetch: async (query: SavedFilterListQuery): Promise<Result<SavedFilterPageJson, Error>> => {
			const res = await fetch_all_saved_filters(query)
			if (Result.isOk(res)) {
				setTables(res.value.tables)
			}
			return res
		},
		setError,
	})

	const tableOptions = (): ComboboxOption[] =>
		tables()
			.map((key: string): ComboboxOption => ({ value: key, label: tableLabel(key) }))
			.sort((a: ComboboxOption, b: ComboboxOption): number => a.label.localeCompare(b.label))

	const filters = useListFilters<SavedFilterEntryJson>({
		search,
		setSearch,
		filters: () => [
			{
				key: 'table',
				label: t('savedFilter.table'),
				options: tableOptions(),
				value: table,
				onChange: setTable,
			},
		],
	})

	async function handleDelete(entry: SavedFilterEntryJson): Promise<void> {
		if (
			!window.confirm(
				t('list.confirmDelete', { noun: tp('noun.savedFilter', 1), name: entry.name }),
			)
		) {
			return
		}
		setError(null)
		const res = await delete_saved_filter(entry)
		if (Result.isError(res)) {
			setError(res.error.message)
		}
	}

	const menuEntry = (key: string | number): SavedFilterEntryJson | undefined =>
		entries.rows().find((e) => rowKey(e) === key)

	const columns: DataTableColumn<SavedFilterEntryJson>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (e: SavedFilterEntryJson): string => e.name,
		},
		{
			key: 'table',
			label: t('savedFilter.table'),
			getValue: (e: SavedFilterEntryJson): JSX.Element => (
				<Show when={tableHref(e.table)} fallback={<span>{tableLabel(e.table)}</span>}>
					{(href: () => string): JSX.Element => (
						<a href={href()}>{tableLabel(e.table)}</a>
					)}
				</Show>
			),
		},
		{
			key: 'values',
			label: t('savedFilter.parameters'),
			getValue: (e: SavedFilterEntryJson): JSX.Element => <FilterValues values={e.values} />,
		},
		{
			key: 'updated',
			label: t('savedFilter.updated'),
			class: 'cell-nowrap',
			getValue: (e: SavedFilterEntryJson): string => formatTime(e.updated_at),
		},
	]

	function rowActions(e: SavedFilterEntryJson): JSX.Element {
		return (
			<div class="row-actions">
				<button
					type="button"
					class="icon-btn"
					title={t('common.editNamed', { name: e.name })}
					aria-label={t('common.editNamed', { name: e.name })}
					onClick={() => setEditing(e)}
				>
					<IconPencil size={16} />
				</button>
				<MoreActionsButton
					name={e.name}
					open={openMenu()?.key === rowKey(e)}
					onToggle={(ev: MouseEvent & { currentTarget: HTMLButtonElement }): void =>
						toggleMenu(ev, rowKey(e), e.name)
					}
					onClose={closeMenu}
				/>
			</div>
		)
	}

	const emptyText = (): string =>
		search()
			? t('list.noMatch', { noun: tp('noun.savedFilter', 2), search: search() })
			: table().length > 0
				? t('list.noMatchFilters', { noun: tp('noun.savedFilter', 2) })
				: t('savedFilter.empty')

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.savedFilter', 2)}</h2>
			</div>

			<FilterTable
				rows={entries.rows}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: tp('noun.savedFilter', 2) })}
				getRowId={rowKey}
				columns={columns}
				rowActions={rowActions}
				pagination={entries.pagination}
				onPaginationChange={entries.onPaginationChange}
				loading={() => entries.page.loading}
				loadingContent={
					<ListLoading rows={entries.rows()} noun={tp('noun.savedFilter', 2)} />
				}
				emptyContent={<Empty message={emptyText()} />}
			/>

			<RowMenu
				menu={openMenu}
				onClose={closeMenu}
				cloneHref={(): undefined => undefined}
				actions={(): [] => []}
				deletable={(menu: RowMenuAnchor): boolean => menuEntry(menu.key) !== undefined}
				onDelete={(menu: RowMenuAnchor): void => {
					const entry = menuEntry(menu.key)
					if (entry) {
						void handleDelete(entry)
					}
				}}
			/>

			<Show when={editing()}>
				{(entry: () => SavedFilterEntryJson): JSX.Element => (
					<EditSavedFilterDialog entry={entry()} on_close={() => setEditing(null)} />
				)}
			</Show>

			<InlineError message={error()} />
		</div>
	)
}
