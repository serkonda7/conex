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
