import type { ComboboxOption } from '@serkonda7/solid-components'
import { IconPencil } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { SavedFilterListQuery, SavedListEntryBase, SavedListPageJson } from 'shared/src/types'
import { createSignal, type JSX, Show } from 'solid-js'
import { t } from '../i18n'
import { usePagedList } from '../lib/paged_list'
import { useAction } from '../lib/resource'
import { tableHref, tableLabel } from '../lib/table_keys'
import { formatTime } from '../lib/time'
import { type DataTableColumn, FilterTable } from './data_table'
import { Empty, InlineError } from './feedback'
import { Hint, TextAreaField, TextField } from './form'
import { ListLoading, RowMenu, type RowMenuAnchor, useListFilters, useRowMenu } from './list_page'
import { Modal } from './modal'
import { MoreActionsButton } from './more_actions_button'

/** The part of a saved-list page that differs per kind (filters, layouts). */
export interface SavedListPageConfig<E extends SavedListEntryBase, P> {
	/** Page heading. */
	title: string
	/** Lower-case noun, singular for 1. */
	noun: (count: number) => string
	/** Shown when nothing was saved yet. */
	emptyText: string
	fetch: (query: SavedFilterListQuery) => Promise<Result<SavedListPageJson<E>, Error>>
	remove: (entry: E) => Promise<Result<unknown, Error>>
	/** The column showing an entry's payload. */
	payloadColumn: { key: string; label: string; render: (entry: E) => JSX.Element }
	/** The edit dialog's raw JSON payload field. */
	edit: {
		title: (name: string) => string
		/** Prefix of the dialog's field ids. */
		idPrefix: string
		label: string
		hint: string
		invalid: string
		rows: number
		payloadOf: (entry: E) => P
		/** Checks the parsed JSON object; null when it is not a valid payload. */
		parse: (raw: Record<string, unknown>) => P | null
		save: (entry: E, name: string, payload: P) => Promise<Result<unknown, Error>>
	}
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: null
}

function rowKey(entry: SavedListEntryBase): string {
	return `${entry.table}/${entry.position}`
}

/** Renames a saved entry or edits its raw payload (JSON). */
function EditSavedEntryDialog<E extends SavedListEntryBase, P>(props: {
	entry: E
	edit: SavedListPageConfig<E, P>['edit']
	on_close: () => void
}): JSX.Element {
	const [name, setName] = createSignal(props.entry.name)
	const [payload, setPayload] = createSignal(
		JSON.stringify(props.edit.payloadOf(props.entry), null, 2),
	)
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const raw = parseJsonObject(payload())
		const parsed = raw === null ? null : props.edit.parse(raw)
		if (parsed === null) {
			setError(props.edit.invalid)
			return
		}
		const saved = await save.run(() => props.edit.save(props.entry, name().trim(), parsed))
		if (saved) {
			props.on_close()
		}
	}

	return (
		<Modal title={props.edit.title(props.entry.name)} on_close={props.on_close}>
			<form class="form-stacked" onSubmit={handleSave}>
				<TextField
					id={`${props.edit.idPrefix}-name`}
					label={t('common.name')}
					required
					autofocus
					maxLength={200}
					value={name()}
					onInput={setName}
				/>
				<TextAreaField
					id={`${props.edit.idPrefix}-payload`}
					label={props.edit.label}
					rows={props.edit.rows}
					value={payload()}
					onInput={setPayload}
				/>
				<Hint>{props.edit.hint}</Hint>
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
 * Overview of one kind of saved lists across every table, shared by all
 * users: entries are renamed, their payload edited, or deleted. Searchable
 * by name and filterable by table.
 */
export function SavedListPage<E extends SavedListEntryBase, P>(
	props: SavedListPageConfig<E, P>,
): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [table, setTable] = createSignal<string[]>([])
	const [editing, setEditing] = createSignal<E | null>(null)
	const [tables, setTables] = createSignal<string[]>([])
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()

	const entries = usePagedList({
		query: () => ({ search: search(), table: table().length > 0 ? table() : undefined }),
		// The response also names every table with saved entries, for the table filter.
		fetch: async (
			query: SavedFilterListQuery,
		): Promise<Result<SavedListPageJson<E>, Error>> => {
			const res = await props.fetch(query)
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

	const filters = useListFilters<E>({
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

	async function handleDelete(entry: E): Promise<void> {
		if (!window.confirm(t('list.confirmDelete', { noun: props.noun(1), name: entry.name }))) {
			return
		}
		setError(null)
		const res = await props.remove(entry)
		if (Result.isError(res)) {
			setError(res.error.message)
		}
	}

	const menuEntry = (key: string | number): E | undefined =>
		entries.rows().find((e) => rowKey(e) === key)

	const columns: DataTableColumn<E>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (e: E): string => e.name,
		},
		{
			key: 'table',
			label: t('savedFilter.table'),
			getValue: (e: E): JSX.Element => (
				<Show when={tableHref(e.table)} fallback={<span>{tableLabel(e.table)}</span>}>
					{(href: () => string): JSX.Element => (
						<a href={href()}>{tableLabel(e.table)}</a>
					)}
				</Show>
			),
		},
		{
			key: props.payloadColumn.key,
			label: props.payloadColumn.label,
			getValue: props.payloadColumn.render,
		},
		{
			key: 'updated',
			label: t('savedFilter.updated'),
			class: 'cell-nowrap',
			getValue: (e: E): string => formatTime(e.updated_at),
		},
	]

	function rowActions(e: E): JSX.Element {
		return (
			<div class="row-actions">
				<button
					type="button"
					class="icon-btn"
					title={t('common.editNamed', { name: e.name })}
					aria-label={t('common.editNamed', { name: e.name })}
					onClick={() => setEditing(() => e)}
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
			? t('list.noMatch', { noun: props.noun(2), search: search() })
			: table().length > 0
				? t('list.noMatchFilters', { noun: props.noun(2) })
				: props.emptyText

	return (
		<div>
			<div class="page-header">
				<h2>{props.title}</h2>
			</div>

			<FilterTable
				rows={entries.rows}
				filters={filters.filters()}
				filterValues={filters.filterValues}
				onFilterValuesChange={filters.onFilterValuesChange}
				manualFiltering
				quickSearchLabel={t('list.searchLabel', { noun: props.noun(2) })}
				getRowId={rowKey}
				columns={columns}
				rowActions={rowActions}
				pagination={entries.pagination}
				onPaginationChange={entries.onPaginationChange}
				loading={() => entries.page.loading}
				loadingContent={<ListLoading rows={entries.rows()} noun={props.noun(2)} />}
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
				{(entry: () => E): JSX.Element => (
					<EditSavedEntryDialog
						entry={entry()}
						edit={props.edit}
						on_close={() => setEditing(null)}
					/>
				)}
			</Show>

			<InlineError message={error()} />
		</div>
	)
}
