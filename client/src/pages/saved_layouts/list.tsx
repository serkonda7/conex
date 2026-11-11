import type { Result } from 'better-result'
import { For, type JSX, Show } from 'solid-js'
import {
	delete_saved_layout,
	fetch_all_saved_layouts,
	type SavedLayoutEntryJson,
	type SavedLayoutJson,
	update_saved_layout,
} from '../../api/saved_layouts'
import { isStringArray, SavedListPage } from '../../components/saved_list_page'
import { t, tp } from '../../i18n'

type Layout = SavedLayoutJson['layout']

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

/** Checks the layout JSON: column key lists plus optional integer widths, else null. */
function parseLayout(raw: Record<string, unknown>): Layout | null {
	const { visibleColumns, columnOrder, columnWidths, ...rest } = raw
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

/**
 * /saved-layouts — overview of the saved column layouts of every table,
 * shared by all users. Layouts are saved from the arrow beside a table's
 * "Columns" button; here they are renamed, their columns edited, or deleted.
 */
export function SavedLayoutsPage(): JSX.Element {
	return (
		<SavedListPage
			title={tp('entity.savedLayout', 2)}
			noun={(n: number): string => tp('noun.savedLayout', n)}
			emptyText={t('savedLayout.empty')}
			fetch={fetch_all_saved_layouts}
			remove={delete_saved_layout}
			payloadColumn={{
				key: 'columns',
				label: t('savedLayout.columns'),
				render: (e: SavedLayoutEntryJson): JSX.Element => (
					<LayoutColumns layout={e.layout} />
				),
			}}
			edit={{
				title: (name: string): string => t('savedLayout.editTitle', { name }),
				idPrefix: 'saved-layout',
				label: t('savedLayout.layout'),
				hint: t('savedLayout.layoutHint'),
				invalid: t('savedLayout.invalidLayout'),
				rows: 12,
				payloadOf: (e: SavedLayoutEntryJson): Layout => e.layout,
				parse: parseLayout,
				save: (
					entry: SavedLayoutEntryJson,
					name: string,
					layout: Layout,
				): Promise<Result<unknown, Error>> => update_saved_layout(entry, { name, layout }),
			}}
		/>
	)
}
