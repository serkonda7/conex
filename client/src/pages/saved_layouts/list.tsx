import type { ComboboxOption } from '@serkonda7/solid-components'
import { IconPencil } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { SavedFilterListQuery } from 'shared/src/types'
import { createSignal, For, type JSX, Show } from 'solid-js'
import {
	delete_saved_layout,
	fetch_all_saved_layouts,
	type SavedLayoutEntryJson,
	type SavedLayoutJson,
	type SavedLayoutPageJson,
	update_saved_layout,
} from '../../api/saved_layouts'
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
import { tableHref, tableLabel } from '../../lib/table_keys'
import { formatTime } from '../../lib/time'

type Layout = SavedLayoutJson['layout']

function rowKey(entry: SavedLayoutEntryJson): string {
	return `${entry.table}/${entry.position}`
}

/** The visible columns in display order, with their pixel width when fixed. */
function LayoutColumns(props: { layout: Layout }): JSX.Element {
	const shown = (): string[] => {
		const visible = new Set(props.layout.visibleColumns)
		const ordered = props.layout.columnOrder.filter((key) => visible.has(key))
		const rest = props.layout.visibleColumns.filter((key) => !ordered.includes(key))
		return [...ordered, ...rest]
	}
	const width = (key: string): number | undefined => props.layout.columnWidths?.[key]
	return (
		<Show
			when={shown().length > 0}
			fallback={<span class="text-muted">{t('savedLayout.noColumns')}</span>}
		>
			<span class="saved-filter-values">
				<For each={shown()}>
					{(key: string): JSX.Element => (
						<code>
							{key}
							<Show when={width(key)}>{(px: () => number) => ` ${px()}px`}</Show>
						</code>
					)}
				</For>
			</span>
		</Show>
	)
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/** Parses the layout textarea: column key lists plus optional integer widths, else null. */
function parseLayout(raw: string): Layout | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return null
	}
	const { visibleColumns, columnOrder, columnWidths, ...rest } = parsed as Record<string, unknown>
	if (
		Object.keys(rest).length > 0 ||
		!isStringArray(visibleColumns) ||
		!isStringArray(columnOrder)
	) {
		return null
	}
	if (columnWidths === undefined) {
		return { visibleColumns, columnOrder }
	}
	if (typeof columnWidths !== 'object' || columnWidths === null || Array.isArray(columnWidths)) {
		return null
	}
	const widths: Record<string, number> = {}
	for (const [key, value] of Object.entries(columnWidths)) {
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
			return null
		}
		widths[key] = value
	}
	return { visibleColumns, columnOrder, columnWidths: widths }
}

/** Renames a saved layout or edits its raw columns and widths (JSON). */
function EditSavedLayoutDialog(props: {
	entry: SavedLayoutEntryJson
	on_close: () => void
}): JSX.Element {
	const [name, setName] = createSignal(props.entry.name)
	const [layout, setLayout] = createSignal(JSON.stringify(props.entry.layout, null, 2))
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const parsed = parseLayout(layout())
		if (parsed === null) {
			setError(t('savedLayout.invalidLayout'))
			return
		}
		const saved = await save.run(() =>
			update_saved_layout(props.entry, { name: name().trim(), layout: parsed }),
		)
		if (saved) {
			props.on_close()
		}
	}

	return (
		<Modal
			title={t('savedLayout.editTitle', { name: props.entry.name })}
			on_close={props.on_close}
		>
			<form class="form-stacked" onSubmit={handleSave}>
				<TextField
					id="saved-layout-name"
					label={t('common.name')}
					required
					autofocus
					maxLength={200}
					value={name()}
					onInput={setName}
				/>
				<TextAreaField
					id="saved-layout-layout"
					label={t('savedLayout.layout')}
					rows={12}
					value={layout()}
					onInput={setLayout}
				/>
				<Hint>{t('savedLayout.layoutHint')}</Hint>
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
 * /saved-layouts — overview of the saved column layouts of every table,
 * shared by all users. Layouts are saved from the arrow beside a table's
 * "Columns" button; here they are renamed, their columns edited, or deleted.
 * Searchable by name and filterable by table.
 */
export function SavedLayoutsPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [table, setTable] = createSignal<string[]>([])
	const [editing, setEditing] = createSignal<SavedLayoutEntryJson | null>(null)
	const [tables, setTables] = createSignal<string[]>([])
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const entries = usePagedList({
		query: () => ({ search: search(), table: table().length > 0 ? table() : undefined }),
		// The response also names every table with saved layouts, for the table filter.
		fetch: async (query: SavedFilterListQuery): Promise<Result<SavedLayoutPageJson, Error>> => {
			const res = await fetch_all_saved_layouts(query)
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

	const filters = useListFilters<SavedLayoutEntryJson>({
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

	async function handleDelete(entry: SavedLayoutEntryJson): Promise<void> {
		if (
			!window.confirm(
				t('list.confirmDelete', { noun: tp('noun.savedLayout', 1), name: entry.name }),
			)
		) {
			return
		}
		setError(null)
		const res = await delete_saved_layout(entry)
		if (Result.isError(res)) {
			setError(res.error.message)
		}
	}

	const menuEntry = (key: string | number): SavedLayoutEntryJson | undefined =>
		entries.rows().find((e) => rowKey(e) === key)

	const columns: DataTableColumn<SavedLayoutEntryJson>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (e: SavedLayoutEntryJson): string => e.name,
		},
		{
			key: 'table',
			label: t('savedFilter.table'),
			getValue: (e: SavedLayoutEntryJson): JSX.Element => (
				<Show when={tableHref(e.table)} fallback={<span>{tableLabel(e.table)}</span>}>
					{(href: () => string): JSX.Element => (
						<a href={href()}>{tableLabel(e.table)}</a>
					)}
				</Show>
			),
		},
		{
			key: 'columns',
			label: t('savedLayout.columns'),
			getValue: (e: SavedLayoutEntryJson): JSX.Element => <LayoutColumns layout={e.layout} />,
		},
		{
			key: 'updated',
			label: t('savedFilter.updated'),
			class: 'cell-nowrap',
			getValue: (e: SavedLayoutEntryJson): string => formatTime(e.updated_at),
		},
	]

	function rowActions(e: SavedLayoutEntryJson): JSX.Element {
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
			? t('list.noMatch', { noun: tp('noun.savedLayout', 2), search: search() })
			: table().length > 0
				? t('list.noMatchFilters', { noun: tp('noun.savedLayout', 2) })
				: t('savedLayout.empty')

	return (
		<div>
			<div class="page-header">
				<h2>{tp('entity.savedLayout', 2)}</h2>
			</div>

			<FilterTable
				rows={entries.rows}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: tp('noun.savedLayout', 2) })}
				getRowId={rowKey}
				columns={columns}
				rowActions={rowActions}
				pagination={entries.pagination}
				onPaginationChange={entries.onPaginationChange}
				loading={() => entries.page.loading}
				loadingContent={
					<ListLoading rows={entries.rows()} noun={tp('noun.savedLayout', 2)} />
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
				{(entry: () => SavedLayoutEntryJson): JSX.Element => (
					<EditSavedLayoutDialog entry={entry()} on_close={() => setEditing(null)} />
				)}
			</Show>

			<InlineError message={error()} />
		</div>
	)
}
