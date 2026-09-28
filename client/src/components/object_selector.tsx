import { Result, type Result as ResultType } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import { t } from '../i18n'
import { Modal } from './modal'

export interface ObjectSearchProps<T extends { id: number }> {
	placeholder?: string
	load: (search: string) => Promise<ResultType<T[], Error>>
	get_label: (object: T) => string
	on_select: (object: T) => void
}

/** Search input with a result list; the body of `ObjectSelector`. */
export function ObjectSearch<T extends { id: number }>(props: ObjectSearchProps<T>): JSX.Element {
	const [search, setSearch] = createSignal('')
	const [objects] = createResource(search, async (value: string) => {
		const result = await props.load(value)
		return Result.isError(result) ? [] : result.value
	})

	return (
		<>
			<input
				autofocus
				class="object-selector-search"
				placeholder={props.placeholder ?? t('common.search')}
				aria-label={t('common.searchObjects')}
				value={search()}
				onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
			/>
			<div class="object-selector-results">
				<Show
					when={!objects.loading}
					fallback={<p class="skeleton">{t('common.loading')}</p>}
				>
					<Show
						when={(objects() ?? []).length > 0}
						fallback={<p class="empty">{t('common.noMatchingObjects')}</p>}
					>
						<ul>
							<For each={objects() ?? []}>
								{(object: T) => (
									<li>
										<button
											type="button"
											class="object-selector-option"
											onClick={() => props.on_select(object)}
										>
											<span>{props.get_label(object)}</span>
											<small>#{object.id}</small>
										</button>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Show>
			</div>
		</>
	)
}

export interface ObjectSelectorProps<T extends { id: number }> extends ObjectSearchProps<T> {
	label: string
	on_close: () => void
}

/** Small NetBox-style searchable object picker. */
export function ObjectSelector<T extends { id: number }>(
	props: ObjectSelectorProps<T>,
): JSX.Element {
	return (
		<Modal title={props.label} class="object-selector" on_close={props.on_close}>
			<ObjectSearch
				placeholder={props.placeholder}
				load={props.load}
				get_label={props.get_label}
				on_select={props.on_select}
			/>
		</Modal>
	)
}
