/**
 * `DataTable` and `FilterTable` from solid-components with their built-in
 * English labels (actions header, column customizer, pager, filter tabs and
 * form) replaced by localized defaults. Pages import them from here instead
 * of the package. Both enable column resizing by default (opt out with
 * `resizableColumns={false}`). Both persist their saved column layouts globally
 * when given a `savedLayoutsKey`; `FilterTable` also persists its saved filters
 * globally and the applied filters per browser when given a `savedFiltersKey`.
 */
import {
	DataTable as BaseDataTable,
	FilterTable as BaseFilterTable,
	type DataTableColumn,
	type DataTablePagination,
	type DataTableProps,
	type FilterTableFilter,
	type FilterTableProps,
	type FilterTableValues,
} from '@serkonda7/solid-components'
import { type JSX, mergeProps, splitProps } from 'solid-js'
import { t } from '../i18n'
import { useTabPath } from '../lib/router'
import { use_saved_filters } from '../lib/saved_filters'
import { use_saved_layouts } from '../lib/saved_layouts'
import { InlineError } from './feedback'

export type {
	DataTableColumn,
	DataTablePagination,
	DataTableProps,
	FilterTableFilter,
	FilterTableProps,
	FilterTableValues,
}

function tableLabels(): Pick<
	DataTableProps<never>,
	| 'actionsLabel'
	| 'columnCustomizerLabel'
	| 'columnCustomizerTitle'
	| 'columnCustomizerShowAllLabel'
	| 'columnCustomizerResetLabel'
	| 'savedLayoutsLabel'
	| 'saveLayoutLabel'
	| 'layoutNameLabel'
	| 'cancelLabel'
	| 'paginationLabels'
> {
	return {
		actionsLabel: t('table.actions'),
		columnCustomizerLabel: t('table.columns'),
		columnCustomizerTitle: t('table.shownColumns'),
		columnCustomizerShowAllLabel: t('table.showAll'),
		columnCustomizerResetLabel: t('table.reset'),
		savedLayoutsLabel: t('table.savedLayouts'),
		saveLayoutLabel: t('table.saveLayout'),
		layoutNameLabel: t('table.layoutName'),
		cancelLabel: t('common.cancel'),
		paginationLabels: {
			navigation: t('table.pagination'),
			previous: t('table.previousPage'),
			next: t('table.nextPage'),
			pageSize: t('table.rowsPerPage'),
			range: (first: number, last: number, total: number): string =>
				t('list.range', { from: first, to: last, total }),
		},
	}
}

/** Saved layouts under `key` as DataTable props, or none without a key. */
function savedLayoutProps(
	saved: ReturnType<typeof use_saved_layouts> | undefined,
): Pick<DataTableProps<never>, 'savedLayouts' | 'onSavedLayoutsChange'> {
	return saved
		? { savedLayouts: saved.savedLayouts, onSavedLayoutsChange: saved.onSavedLayoutsChange }
		: {}
}

/**
 * `savedLayoutsKey` turns on saved column layouts (needs `showColumnCustomizer`),
 * stored on the server under that table key and shared by all users; a failed
 * load or save shows below the table.
 */
export function DataTable<TRow>(
	props: DataTableProps<TRow> & { savedLayoutsKey?: string },
): JSX.Element {
	const [local, tableProps] = splitProps(props, ['savedLayoutsKey'])
	const layouts = local.savedLayoutsKey ? use_saved_layouts(local.savedLayoutsKey) : undefined
	const merged = mergeProps(
		{ resizableColumns: true },
		tableLabels(),
		savedLayoutProps(layouts),
		tableProps,
	)
	return (
		<>
			<BaseDataTable {...merged} />
			{layouts && <InlineError message={layouts.error()} />}
		</>
	)
}

/**
 * `savedFiltersKey` turns on saved filters, stored on the server under that
 * table key and shared by all users; a failed load or save shows below the table.
 * It also keeps the applied filters in localStorage under
 * `conex:filters:<key>`, restored on the next visit unless the tab was opened
 * with a query (a deep link such as `/sites?tenant=<id>` sets its own filters).
 * `savedLayoutsKey` works as on {@link DataTable}.
 */
export function FilterTable<TRow>(
	props: FilterTableProps<TRow> & { savedFiltersKey?: string; savedLayoutsKey?: string },
): JSX.Element {
	const [local, tableProps] = splitProps(props, ['savedFiltersKey', 'savedLayoutsKey'])
	const saved = local.savedFiltersKey ? use_saved_filters(local.savedFiltersKey) : undefined
	const layouts = local.savedLayoutsKey ? use_saved_layouts(local.savedLayoutsKey) : undefined
	const deepLink = useTabPath().split('#')[0]?.includes('?') ?? false
	const merged = mergeProps(
		{ resizableColumns: true },
		tableLabels(),
		{
			quickSearchLabel: t('common.quickSearch'),
			resultsLabel: t('table.results'),
			filtersLabel: t('table.filters'),
			applyLabel: t('table.applyFilters'),
			resetLabel: t('table.reset'),
			clearAllLabel: t('table.clearAll'),
			anyLabel: t('table.any'),
			yesLabel: t('common.yes'),
			noLabel: t('common.no'),
			savedFiltersLabel: t('table.savedFilters'),
			saveLabel: t('common.save'),
			saveNameLabel: t('table.filterName'),
			clearSavedFilterLabel: t('table.clearSavedFilter'),
			removeLabel: t('table.removeValue'),
		},
		saved
			? {
					savedFilters: saved.savedFilters,
					onSavedFiltersChange: saved.onSavedFiltersChange,
					filterStorageKey: `conex:filters:${local.savedFiltersKey}`,
					restoreFilters: !deepLink,
				}
			: {},
		savedLayoutProps(layouts),
		tableProps,
	)
	return (
		<>
			<BaseFilterTable {...merged} />
			{saved && <InlineError message={saved.error()} />}
			{layouts && <InlineError message={layouts.error()} />}
		</>
	)
}

/**
 * Column linking each row to its detail page (`<base>/<id>`). In-app links
 * need no click handler: the shell routes every plain `<a href="/…">`.
 */
export function nameColumn<TRow extends { id: number; name: string }>(
	label: string,
	base: string,
	opts?: { sortable?: boolean; rowLabel?: (row: TRow) => string },
): DataTableColumn<TRow> {
	return {
		key: 'name',
		label,
		sortable: opts?.sortable,
		getValue: (row: TRow): JSX.Element => (
			<a href={`${base}/${row.id}`}>{opts?.rowLabel ? opts.rowLabel(row) : row.name}</a>
		),
	}
}

/** Truncated description column with the full text as tooltip. */
export function descriptionColumn<TRow extends { description: string | null }>(opts?: {
	sortable?: boolean
}): DataTableColumn<TRow> {
	return {
		key: 'description',
		label: t('common.description'),
		sortable: opts?.sortable,
		class: 'cell-truncate',
		getValue: (row: TRow): JSX.Element => (
			<span title={row.description ?? ''}>{row.description || '—'}</span>
		),
	}
}
