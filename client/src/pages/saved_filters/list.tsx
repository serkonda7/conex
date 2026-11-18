import { Result } from 'better-result'
import { createSignal, For, type JSX, Show } from 'solid-js'
import {
	delete_saved_filter,
	fetch_all_saved_filters,
	type SavedFilterEntryJson,
	type SavedFilterJson,
	update_saved_filter,
} from '../../api/saved_filters'
import { fetch_saved_layouts } from '../../api/saved_layouts'
import { SelectField } from '../../components/form'
import { isStringArray, SavedListPage } from '../../components/saved_list_page'
import { t, tp } from '../../i18n'

type Values = SavedFilterJson['values']

/** `key = value` lines of a filter; lists join with commas. */
function FilterValues(props: { values: Values }): JSX.Element {
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

/** Checks the parameters JSON: an object of strings or string lists, else null. */
function parseValues(raw: Record<string, unknown>): Values | null {
	const values: Values = {}
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value !== 'string' && !isStringArray(value)) {
			return null
		}
		values[key] = value
	}
	return values
}

/**
 * Names of each table's saved layouts, fetched once per table on first use;
 * `undefined` while loading or after a failed load (then nothing shows as
 * missing).
 */
function useLayoutNames(): (table: string) => string[] | undefined {
	const [names, setNames] = createSignal<Record<string, string[]>>({})
	const requested = new Set<string>()
	return (table: string): string[] | undefined => {
		if (!requested.has(table)) {
			requested.add(table)
			void fetch_saved_layouts(table).then((res) => {
				if (Result.isOk(res)) {
					setNames((all) => ({ ...all, [table]: res.value.map((layout) => layout.name) }))
				}
			})
		}
		return names()[table]
	}
}

/** A saved filter's layout reference, marked when no saved layout has that name. */
function LayoutRef(props: { name: string | undefined; names: string[] | undefined }): JSX.Element {
	const missing = (): boolean =>
		props.names !== undefined && !props.names.includes(props.name ?? '')
	return (
		<Show when={props.name} fallback={<span class="text-muted">—</span>}>
			{(name: () => string): JSX.Element => (
				<Show when={missing()} fallback={<span>{name()}</span>}>
					<span class="text-muted" title={t('savedFilter.layoutMissingHint')}>
						{t('savedFilter.layoutMissing', { name: name() })}
					</span>
				</Show>
			)}
		</Show>
	)
}

/** The edit dialog's layout picker over the table's saved layouts; `''` is none. */
function layoutField(
	entry: SavedFilterEntryJson,
	names: (table: string) => string[] | undefined,
): { field: JSX.Element; value: () => string } {
	const [layout, setLayout] = createSignal(entry.layout ?? '')
	const options = (): { value: string; label: string }[] => {
		const known = names(entry.table) ?? []
		const kept =
			entry.layout !== undefined && !known.includes(entry.layout)
				? [
						{
							value: entry.layout,
							label: t('savedFilter.layoutMissing', { name: entry.layout }),
						},
					]
				: []
		return [...known.map((name) => ({ value: name, label: name })), ...kept]
	}
	return {
		field: (
			<SelectField
				id="saved-filter-layout"
				label={t('savedFilter.layout')}
				value={layout()}
				onChange={setLayout}
				options={options()}
				emptyLabel={t('table.noLayout')}
				hint={t('savedFilter.layoutHint')}
			/>
		),
		value: layout,
	}
}

/**
 * /saved-filters — NetBox-style overview of the saved filters of every
 * list, shared by all users. Filters are created from a list's "Saved
 * filters" tab; here they are renamed, their raw parameters edited (for
 * values the table's own filter form cannot reach anymore, e.g. a removed
 * option), their column layout picked, or deleted. A layout reference no
 * saved layout of the table matches anymore shows as missing.
 */
export function SavedFiltersPage(): JSX.Element {
	const layoutNames = useLayoutNames()
	return (
		<SavedListPage
			title={tp('entity.savedFilter', 2)}
			noun={(n: number): string => tp('noun.savedFilter', n)}
			emptyText={t('savedFilter.empty')}
			fetch={fetch_all_saved_filters}
			remove={delete_saved_filter}
			payloadColumns={[
				{
					key: 'values',
					label: t('savedFilter.parameters'),
					render: (e: SavedFilterEntryJson): JSX.Element => (
						<FilterValues values={e.values} />
					),
				},
				{
					key: 'layout',
					label: t('savedFilter.layout'),
					render: (e: SavedFilterEntryJson): JSX.Element => (
						<LayoutRef name={e.layout} names={layoutNames(e.table)} />
					),
				},
			]}
			edit={{
				title: (name: string): string => t('savedFilter.editTitle', { name }),
				idPrefix: 'saved-filter',
				label: t('savedFilter.parameters'),
				hint: t('savedFilter.parametersHint'),
				invalid: t('savedFilter.invalidParameters'),
				rows: 8,
				payloadOf: (e: SavedFilterEntryJson): Values => e.values,
				parse: parseValues,
				extra: (entry: SavedFilterEntryJson) => layoutField(entry, layoutNames),
				save: (
					entry: SavedFilterEntryJson,
					name: string,
					values: Values,
					layout: string | undefined,
				): Promise<Result<unknown, Error>> =>
					update_saved_filter(
						entry,
						layout ? { name, values, layout } : { name, values },
					),
			}}
		/>
	)
}
