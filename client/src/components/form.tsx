/**
 * Shared building blocks for the entity create forms: the page shell,
 * labelled field wrappers, and the submit/cancel action row.
 *
 * Field ids stay page-specific (`#site-name`, …) because the e2e smoke test
 * and the detail-page deep links address them directly.
 */
import type { InputEventAndTarget } from 'shared/src/types'
import { For, type JSX, onMount, Show } from 'solid-js'
import { navigate } from '../router'
import { Loading } from './feedback'
import { go } from './list_page'

/** Default hint under a slug input, where the slug is auto-filled from the name. */
const SLUG_HINT =
	'URL-safe identifier: lowercase letters, digits, single dashes. Auto-filled from the name.'

/** One `<select>` entry. */
export interface FormOption {
	value: number | string
	label: string
}

/** Maps list rows (`{ id, name }`) to `<select>` options. */
export function row_options(rows: { id: number; name: string }[]): FormOption[] {
	return rows.map((row) => ({ value: row.id, label: row.name }))
}

/** Wraps a plain anchor so cancel/back closes the form tab without
 * refreshing, keeping the underlying list's exact contents. */
function goNoRefresh(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to, { refresh: false })
}

/** Muted helper text below a field control. */
export function Hint(props: { id?: string; children: JSX.Element }): JSX.Element {
	return (
		<p class="field-hint" id={props.id}>
			{props.children}
		</p>
	)
}

/** Label + control + hint wrapper, keeping the `for`/`id` pairing in one place.
 * Two-column layout: the label sits in the left column, the control and
 * hint stack in the right column via `.field-control`. */
export function Field(props: {
	label: string
	for: string
	required?: boolean
	hint?: JSX.Element
	children: JSX.Element
}): JSX.Element {
	return (
		<div class="field">
			<label for={props.for}>
				{props.label}{' '}
				<Show when={props.required}>
					<span class="required" aria-hidden="true">
						*
					</span>
				</Show>
			</label>
			<div class="field-control">
				{props.children}
				{props.hint}
			</div>
		</div>
	)
}

/** Single-line text input; `type` defaults to text. */
export function TextField(props: {
	id: string
	label: string
	value: string
	onInput: (value: string) => void
	placeholder?: string
	type?: 'text' | 'password' | 'number'
	maxLength?: number
	min?: number
	step?: number
	required?: boolean
	inputmode?: 'numeric' | 'text'
	autocomplete?: string
	autofocus?: boolean
	hint?: JSX.Element
}): JSX.Element {
	let input: HTMLInputElement | undefined
	onMount(() => {
		if (props.autofocus ?? false) {
			input?.focus()
		}
	})

	return (
		<Field label={props.label} for={props.id} required={props.required} hint={props.hint}>
			<input
				id={props.id}
				ref={input}
				type={props.type ?? 'text'}
				placeholder={props.placeholder}
				required={props.required}
				maxLength={props.maxLength}
				min={props.min}
				step={props.step}
				inputmode={props.inputmode}
				autocomplete={props.autocomplete}
				data-autofocus={props.autofocus || undefined}
				value={props.value}
				onInput={(e: InputEventAndTarget) => props.onInput(e.currentTarget.value)}
			/>
		</Field>
	)
}

/** Multi-line text input. */
export function TextAreaField(props: {
	id: string
	label: string
	value: string
	onInput: (value: string) => void
	placeholder?: string
	rows?: number
	maxLength?: number
}): JSX.Element {
	return (
		<Field label={props.label} for={props.id}>
			<textarea
				id={props.id}
				placeholder={props.placeholder}
				rows={props.rows ?? 4}
				maxLength={props.maxLength}
				value={props.value}
				onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) =>
					props.onInput(e.currentTarget.value)
				}
			/>
		</Field>
	)
}

/** Dropdown of `options`, with an optional leading empty choice. */
export function SelectField(props: {
	id: string
	label: string
	value: string
	/** Omitted on read-only selects (e.g. placeholders for unbuilt features). */
	onChange?: (value: string) => void
	options: FormOption[]
	/** Label of the `<option value="">` first entry; omit for no empty choice. */
	emptyLabel?: string
	required?: boolean
	disabled?: boolean
	autofocus?: boolean
	describedBy?: string
	hint?: JSX.Element
	action?: JSX.Element
	/** Extra `<option>` entries after the generated ones (e.g. a stale value). */
	children?: JSX.Element
}): JSX.Element {
	let select: HTMLSelectElement | undefined
	onMount(() => {
		if (props.autofocus ?? false) {
			select?.focus()
		}
	})

	return (
		<Field label={props.label} for={props.id} required={props.required} hint={props.hint}>
			<div class="field-inline-actions">
				<select
					id={props.id}
					ref={select}
					required={props.required}
					disabled={props.disabled}
					data-autofocus={props.autofocus || undefined}
					aria-describedby={props.describedBy}
					value={props.value}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						props.onChange?.(e.currentTarget.value)
					}
				>
					<Show when={props.emptyLabel}>
						<option value="">{props.emptyLabel}</option>
					</Show>
					<For each={props.options}>
						{(option: FormOption): JSX.Element => (
							<option value={option.value}>{option.label}</option>
						)}
					</For>
					{props.children}
				</select>
				{props.action}
			</div>
		</Field>
	)
}

/** Required entity name input, optionally autofocused when the form mounts. */
export function NameField(props: {
	id: string
	placeholder: string
	value: string
	onInput: (value: string) => void
	autofocus?: boolean
}): JSX.Element {
	let input: HTMLInputElement | undefined
	onMount(() => {
		if (props.autofocus ?? false) {
			input?.focus()
		}
	})

	return (
		<Field label="Name" for={props.id} required>
			<input
				id={props.id}
				ref={input}
				placeholder={props.placeholder}
				required
				maxLength={100}
				data-autofocus={props.autofocus || undefined}
				value={props.value}
				onInput={(e: InputEventAndTarget) => props.onInput(e.currentTarget.value)}
			/>
		</Field>
	)
}

/** Required URL slug input, pattern-checked against `SlugSchema`. */
export function SlugField(props: {
	id: string
	placeholder: string
	value: string
	onInput: (value: string) => void
	/** Overrides the auto-fill hint (edit forms use the shorter variant). */
	hint?: JSX.Element
}): JSX.Element {
	return (
		<Field label="Slug" for={props.id} required hint={props.hint ?? <Hint>{SLUG_HINT}</Hint>}>
			<input
				id={props.id}
				placeholder={props.placeholder}
				required
				maxLength={100}
				pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
				value={props.value}
				onInput={(e: InputEventAndTarget) => props.onInput(e.currentTarget.value)}
			/>
		</Field>
	)
}

/** Inline form-level error, announced to assistive tech. */
export function FormError(props: { message: () => string | null }): JSX.Element {
	return (
		<Show when={props.message()}>
			<div class="app-inline-error" role="alert">
				{props.message()}
			</div>
		</Show>
	)
}

/** Create actions, disabled while the form is saving. Cancel closes the tab
 * without refreshing so the underlying list keeps its exact contents. */
export function FormActions(props: { saving: boolean; cancelTo: string }): JSX.Element {
	return (
		<div class="form-actions">
			<button
				type="button"
				onClick={() => navigate(props.cancelTo, { refresh: false })}
				disabled={props.saving}
			>
				Cancel
			</button>
			<button type="submit" name="action" value="create" disabled={props.saving}>
				{props.saving ? 'Creating…' : 'Create'}
			</button>
			<button type="submit" name="action" value="add-another" disabled={props.saving}>
				Create &amp; Add Another
			</button>
		</div>
	)
}

/** Create-page shell: back link, heading, and the stacked form. */
export function FormPage(props: {
	backTo: string
	backLabel: string
	title: string
	onSubmit: (e: SubmitEvent) => void
	children: JSX.Element
}): JSX.Element {
	return (
		<div class="form-page">
			<p>
				<a
					href={props.backTo}
					onClick={(e: MouseEvent): void => goNoRefresh(e, props.backTo)}
				>
					← {props.backLabel}
				</a>
			</p>
			<h2>{props.title}</h2>
			<form class="form-stacked" onSubmit={props.onSubmit}>
				{props.children}
			</form>
		</div>
	)
}

/** Edit actions, disabled while the form is saving. Save navigates back to
 * the detail page; cancel returns without forcing a refresh. */
export function EditActions(props: { saving: boolean; cancelTo: string }): JSX.Element {
	return (
		<div class="form-actions">
			<button type="submit" disabled={props.saving}>
				{props.saving ? 'Saving…' : 'Save'}
			</button>
			<button type="button" onClick={() => navigate(props.cancelTo)} disabled={props.saving}>
				Cancel
			</button>
		</div>
	)
}

/**
 * Edit-page shell: back link to the detail page, heading, and the stacked
 * form gated on the loaded flag. `backLabel` is the entity name once loaded
 * (callers pass `entity()?.name ?? 'Fallback'`); `loadingText` preserves
 * each page's exact skeleton string.
 */
export function EditPageShell(props: {
	backTo: string
	backLabel: string
	title: string
	loaded: boolean
	loadingText: string
	onSubmit: (e: SubmitEvent) => void
	children: JSX.Element
}): JSX.Element {
	return (
		<div class="form-page">
			<p>
				<a href={props.backTo} onClick={(e: MouseEvent): void => go(e, props.backTo)}>
					← {props.backLabel}
				</a>
			</p>
			<h2>{props.title}</h2>
			<Show when={props.loaded} fallback={<Loading message={props.loadingText} />}>
				<form class="form-stacked" onSubmit={props.onSubmit}>
					{props.children}
				</form>
			</Show>
		</div>
	)
}
