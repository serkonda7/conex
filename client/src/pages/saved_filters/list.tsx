import type { Result } from 'better-result'
import { For, type JSX, Show } from 'solid-js'
import {
	delete_saved_filter,
	fetch_all_saved_filters,
	type SavedFilterEntryJson,
	type SavedFilterJson,
	update_saved_filter,
} from '../../api/saved_filters'
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
 * /saved-filters — NetBox-style overview of the saved filters of every
 * list, shared by all users. Filters are created from a list's "Saved
 * filters" tab; here they are renamed, their raw parameters edited (for
 * values the table's own filter form cannot reach anymore, e.g. a removed
 * option), or deleted.
 */
export function SavedFiltersPage(): JSX.Element {
	return (
		<SavedListPage
			title={tp('entity.savedFilter', 2)}
			noun={(n: number): string => tp('noun.savedFilter', n)}
			emptyText={t('savedFilter.empty')}
			fetch={fetch_all_saved_filters}
			remove={delete_saved_filter}
			payloadColumn={{
				key: 'values',
				label: t('savedFilter.parameters'),
				render: (e: SavedFilterEntryJson): JSX.Element => (
					<FilterValues values={e.values} />
				),
			}}
			edit={{
				title: (name: string): string => t('savedFilter.editTitle', { name }),
				idPrefix: 'saved-filter',
				label: t('savedFilter.parameters'),
				hint: t('savedFilter.parametersHint'),
				invalid: t('savedFilter.invalidParameters'),
				rows: 8,
				payloadOf: (e: SavedFilterEntryJson): Values => e.values,
				parse: parseValues,
				save: (
					entry: SavedFilterEntryJson,
					name: string,
					values: Values,
				): Promise<Result<unknown, Error>> => update_saved_filter(entry, { name, values }),
			}}
		/>
	)
}
