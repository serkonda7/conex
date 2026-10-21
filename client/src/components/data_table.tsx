/**
 * `DataTable` and `FilterTable` from solid-components with their built-in
 * English labels (column customizer, filter tabs and
 * form) replaced by localized defaults. Pages import them from here instead
 * of the package. Both enable column resizing by default (opt out with
 * `resizableColumns={false}`). `FilterTable` also persists its saved filters globally
 * when given a `savedFiltersKey`.
 */
import {
	DataTable as BaseDataTable,
	FilterTable as BaseFilterTable,
	type DataTableColumn,
	type DataTableProps,
	type FilterTableFilter,
	type FilterTableProps,
	type FilterTableValues,
} from '@serkonda7/solid-components'
import { type JSX, mergeProps, splitProps } from 'solid-js'
import { t } from '../i18n'
import { use_saved_filters } from '../lib/saved_filters'
import { InlineError } from './feedback'

export type {
	DataTableColumn,
	DataTableProps,
	FilterTableFilter,
	FilterTableProps,
	FilterTableValues,
}

function tableLabels(): Pick<
	DataTableProps<never>,
	| 'columnCustomizerLabel'
	| 'columnCustomizerTitle'
	| 'columnCustomizerShowAllLabel'
	| 'columnCustomizerResetLabel'
> {
	return {
		columnCustomizerLabel: t('table.columns'),
		columnCustomizerTitle: t('table.shownColumns'),
		columnCustomizerShowAllLabel: t('table.showAll'),
		columnCustomizerResetLabel: t('table.reset'),
	}
}

export function DataTable<TRow>(props: DataTableProps<TRow>): JSX.Element {
	const merged = mergeProps({ resizableColumns: true }, tableLabels(), props)
	return <BaseDataTable {...merged} />
}

/**
 * `savedFiltersKey` turns on saved filters, stored on the server under that
 * table key and shared by all users; a failed load or save shows below the table.
 */
export function FilterTable<TRow>(
	props: FilterTableProps<TRow> & { savedFiltersKey?: string },
): JSX.Element {
	const [local, tableProps] = splitProps(props, ['savedFiltersKey'])
	const saved = local.savedFiltersKey ? use_saved_filters(local.savedFiltersKey) : undefined
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
			saveLabel: t('table.saveFilter'),
			saveNameLabel: t('table.filterName'),
			cancelLabel: t('common.cancel'),
			clearSavedFilterLabel: t('table.clearSavedFilter'),
		},
		saved
			? {
					savedFilters: saved.savedFilters,
					onSavedFiltersChange: saved.onSavedFiltersChange,
				}
			: {},
		tableProps,
	)
	return (
		<>
			<BaseFilterTable {...merged} />
			{saved && <InlineError message={saved.error()} />}
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
	opts?: { sortable?: boolean },
): DataTableColumn<TRow> {
	return {
		key: 'name',
		label,
		sortable: opts?.sortable,
		getValue: (row: TRow): JSX.Element => <a href={`${base}/${row.id}`}>{row.name}</a>,
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
