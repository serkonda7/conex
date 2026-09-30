/**
 * `DataTable` from solid-components with its built-in English labels
 * (column customizer, select-all checkbox) replaced by localized defaults.
 * Pages import `DataTable` from here instead of the package.
 */
import {
	DataTable as BaseDataTable,
	type DataTableColumn,
	type DataTableProps,
} from '@serkonda7/solid-components'
import { type JSX, mergeProps } from 'solid-js'
import { t } from '../i18n'

export type { DataTableColumn, DataTableProps }

export function DataTable<TRow>(props: DataTableProps<TRow>): JSX.Element {
	const merged = mergeProps(
		{
			selectionLabel: t('table.selectAllRows'),
			columnCustomizerLabel: t('table.columns'),
			columnCustomizerTitle: t('table.shownColumns'),
			columnCustomizerShowAllLabel: t('table.showAll'),
			columnCustomizerResetLabel: t('table.reset'),
		},
		props,
	)
	return <BaseDataTable {...merged} />
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
