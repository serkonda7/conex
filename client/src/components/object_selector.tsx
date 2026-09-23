import { Result, type Result as ResultType } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'

export interface ObjectSelectorProps<T extends { id: number }> {
	label: string
	placeholder?: string
	load: (search: string) => Promise<ResultType<T[], Error>>
	get_label: (object: T) => string
	on_select: (object: T) => void
	on_close: () => void
}

/** Small NetBox-style searchable object picker. */
export function ObjectSelector<T extends { id: number }>(
	props: ObjectSelectorProps<T>,
): JSX.Element {
	const [search, setSearch] = createSignal('')
	const [objects] = createResource(search, async (value: string) => {
		const result = await props.load(value)
		return Result.isError(result) ? [] : result.value
	})

	return (
		<div class="modal-wrap" role="presentation">
			<button
				type="button"
				class="modal-backdrop"
				aria-label="Close"
				onClick={props.on_close}
			/>
			<section
				class="modal object-selector"
				role="dialog"
				aria-modal="true"
				aria-label={props.label}
			>
				<div class="object-selector-header">
					<h3>{props.label}</h3>
					<button
						type="button"
						class="icon-btn"
						aria-label="Close"
						onClick={props.on_close}
					>
						×
					</button>
				</div>
				<input
					autofocus
					class="object-selector-search"
					placeholder={props.placeholder ?? 'Search…'}
					aria-label="Search objects"
					value={search()}
					onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
				/>
				<div class="object-selector-results">
					<Show when={!objects.loading} fallback={<p class="skeleton">Loading…</p>}>
						<Show
							when={(objects() ?? []).length > 0}
							fallback={<p class="empty">Keine passenden Einträge gefunden.</p>}
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
			</section>
		</div>
	)
}
