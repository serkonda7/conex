/**
 * `DataTable` and `FilterTable` from solid-components with their built-in
 * English labels (column customizer, select-all checkbox, filter tabs and
 * form) replaced by localized defaults. Pages import them from here instead
 * of the package.
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
import { type JSX, mergeProps } from 'solid-js'
import { t } from '../i18n'

export type {
	DataTableColumn,
	DataTableProps,
	FilterTableFilter,
	FilterTableProps,
	FilterTableValues,
}

function tableLabels(): Pick<
	DataTableProps<never>,
	| 'selectionLabel'
	| 'columnCustomizerLabel'
	| 'columnCustomizerTitle'
	| 'columnCustomizerShowAllLabel'
	| 'columnCustomizerResetLabel'
> {
	return {
		selectionLabel: t('table.selectAllRows'),
		columnCustomizerLabel: t('table.columns'),
		columnCustomizerTitle: t('table.shownColumns'),
		columnCustomizerShowAllLabel: t('table.showAll'),
		columnCustomizerResetLabel: t('table.reset'),
	}
}

export function DataTable<TRow>(props: DataTableProps<TRow>): JSX.Element {
	const merged = mergeProps(tableLabels(), props)
	return <BaseDataTable {...merged} />
}

export function FilterTable<TRow>(props: FilterTableProps<TRow>): JSX.Element {
	const merged = mergeProps(
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
		},
		props,
	)
	return <BaseFilterTable {...merged} />
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
