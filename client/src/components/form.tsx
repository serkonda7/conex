/**
 * Shared building blocks for the entity add/edit forms: the page shell with
 * its error line and action row, and labelled field wrappers.
 *
 * Field ids stay page-specific (`#site-name`, `#site-edit-name`, …) because
 * the e2e tests and the detail-page deep links address them directly.
 */

import { Combobox, type ComboboxOption } from '@serkonda7/solid-components'
import type { InputEventAndTarget } from 'shared/src/types'
import { type JSX, onMount, Show } from 'solid-js'
import { t } from '../i18n'
import type { FormState } from '../lib/form'
import { type Crumb, navigate, usePageMeta } from '../lib/router'
import { InlineError, Loading } from './feedback'

/** One `SelectField` entry. */
export type FormOption = ComboboxOption

/** Maps list rows (`{ id, name }`) to `SelectField` options. */
export function row_options(rows: readonly { id: number; name: string }[]): FormOption[] {
	return rows.map((row) => ({ value: row.id, label: row.name }))
}

/** Focuses `el` on mount when `autofocus` is set. */
function useAutofocus(autofocus: () => boolean | undefined): (el: HTMLElement) => void {
	let target: HTMLElement | undefined
	onMount(() => {
		if (autofocus() === true) {
			target?.focus()
		}
	})
	return (el: HTMLElement): void => {
		target = el
	}
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
	type?: 'text' | 'password' | 'number' | 'email' | 'tel'
	maxLength?: number
	min?: number
	max?: number
	step?: number
	required?: boolean
	disabled?: boolean
	inputmode?: 'numeric' | 'text'
	autocomplete?: string
	autofocus?: boolean
	pattern?: string
	hint?: JSX.Element
}): JSX.Element {
	const ref = useAutofocus(() => props.autofocus)
	return (
		<Field label={props.label} for={props.id} required={props.required} hint={props.hint}>
			<input
				id={props.id}
				ref={ref}
				type={props.type}
				placeholder={props.placeholder}
				required={props.required}
				disabled={props.disabled}
				maxLength={props.maxLength}
				min={props.min}
				max={props.max}
				step={props.step}
				pattern={props.pattern}
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

/** Checkbox in the control column, labelled by the text next to it. */
export function CheckboxField(props: {
	id: string
	label: string
	checked: boolean
	onChange: (checked: boolean) => void
}): JSX.Element {
	return (
		<div class="field">
			<div class="field-control">
				<label class="field-checkbox-label">
					<input
						id={props.id}
						type="checkbox"
						checked={props.checked}
						onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
							props.onChange(e.currentTarget.checked)
						}
					/>
					{props.label}
				</label>
			</div>
		</div>
	)
}

/** Disabled input showing a value the form cannot change, with the reason below. */
export function ReadOnlyField(props: {
	id: string
	label: string
	value: string
	hint: string
}): JSX.Element {
	return (
		<Field
			label={props.label}
			for={props.id}
			hint={<Hint id={`${props.id}-hint`}>{props.hint}</Hint>}
		>
			<input
				id={props.id}
				value={props.value}
				disabled
				aria-describedby={`${props.id}-hint`}
			/>
		</Field>
	)
}

/** Titled group of related fields within a stacked form. */
export function FormSection(props: { title: string; children: JSX.Element }): JSX.Element {
	return (
		<fieldset class="field-fieldset form-section">
			<legend class="form-section-title">{props.title}</legend>
			{props.children}
		</fieldset>
	)
}

/** Required entity name input, optionally autofocused when the form mounts. */
export function NameField(props: {
	id: string
	placeholder?: string
	value: string
	onInput: (value: string) => void
	autofocus?: boolean
	disabled?: boolean
}): JSX.Element {
	return <TextField {...props} label={t('common.name')} required maxLength={100} />
}

/** Required URL slug input, pattern-checked against `SlugSchema`. Create
 * forms note that the slug is auto-filled from the name. */
export function SlugField(props: {
	id: string
	placeholder: string
	value: string
	onInput: (value: string) => void
	/** Edit forms: the slug no longer follows the name. */
	editing?: boolean
}): JSX.Element {
	return (
		<TextField
			id={props.id}
			label={t('common.slug')}
			placeholder={props.placeholder}
			required
			maxLength={100}
			pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
			value={props.value}
			onInput={props.onInput}
			hint={
				<Hint>{props.editing === true ? t('form.slugHintEdit') : t('form.slugHint')}</Hint>
			}
		/>
	)
}

/** The optional one-line description every entity form offers. */
export function DescriptionField(props: {
	id: string
	value: string
	onInput: (value: string) => void
}): JSX.Element {
	return <TextField {...props} label={t('common.description')} maxLength={500} />
}

/** The optional free-text comments field. */
export function CommentsField(props: {
	id: string
	value: string
	onInput: (value: string) => void
}): JSX.Element {
	return (
		<TextAreaField
			{...props}
			label={t('common.comments')}
			placeholder={t('common.commentsPlaceholder')}
			maxLength={2000}
		/>
	)
}

/** Searchable dropdown of `options` (the solid-components `Combobox`), with
 * an optional leading empty choice. The numeric value sits in `data-value`
 * for e2e tests. `reload` refetches the options whenever the list opens, and
 * `add` pins an entry at the end of the list that opens the add form of the
 * option kind, passing the typed search as `?name=`. */
export function SelectField(props: {
	id: string
	label: string
	value: string
	/** Omitted on read-only selects (e.g. placeholders for unbuilt features). */
	onChange?: (value: string) => void
	options: FormOption[]
	/** Label of the empty (`''`) first entry; omit for no empty choice. */
	emptyLabel?: string
	required?: boolean
	disabled?: boolean
	autofocus?: boolean
	describedBy?: string
	hint?: JSX.Element
	reload?: () => unknown
	/** Entity label and add-form path of the pinned "Add …" entry. */
	add?: { label: string; href: string }
}): JSX.Element {
	onMount(() => {
		// The tab shell refocuses `[data-autofocus]` when the tab is reactivated.
		if (props.autofocus === true) {
			document.querySelector(`#${CSS.escape(props.id)}`)?.setAttribute('data-autofocus', '')
		}
	})

	function openAddForm(name: string): void {
		const href = props.add?.href
		if (href !== undefined) {
			// The add form starts with whatever was typed as its name.
			navigate(name === '' ? href : `${href}?name=${encodeURIComponent(name)}`)
		}
	}

	return (
		<Field label={props.label} for={props.id} required={props.required} hint={props.hint}>
			<Combobox
				id={props.id}
				value={props.value}
				onChange={props.onChange}
				options={props.options}
				emptyLabel={props.emptyLabel}
				required={props.required}
				disabled={props.disabled}
				autofocus={props.autofocus}
				describedBy={props.describedBy}
				onOpen={props.reload}
				onAdd={props.add ? openAddForm : undefined}
				addLabel={props.add ? t('app.navAdd', { label: props.add.label }) : undefined}
				searchLabel={t('common.search')}
				noMatchesLabel={t('common.noMatchingObjects')}
			/>
		</Field>
	)
}

/** Create actions. Cancel closes the tab back into the page that opened
 * it, keeping its exact contents (`cancelTo` when there is none); `singleton` drops "Create & Add
 * Another" for one-of-a-kind objects. */
function CreateActions(props: {
	saving: boolean
	cancelTo: string
	singleton?: boolean
}): JSX.Element {
	return (
		<div class="form-actions">
			<button
				type="button"
				onClick={() => navigate(props.cancelTo, { refresh: false, back: true })}
				disabled={props.saving}
			>
				{t('common.cancel')}
			</button>
			<button type="submit" name="action" value="create" disabled={props.saving}>
				{props.saving ? t('common.creating') : t('common.create')}
			</button>
			<Show when={props.singleton !== true}>
				<button type="submit" name="action" value="add-another" disabled={props.saving}>
					{t('common.createAndAddAnother')}
				</button>
			</Show>
		</div>
	)
}

/** Edit actions: save lands on `cancelTo` refreshed, cancel returns as is. */
function EditActions(props: {
	saving: boolean
	cancelTo: string
	onDelete?: () => void
}): JSX.Element {
	return (
		<div class="form-actions">
			<button type="submit" disabled={props.saving}>
				{props.saving ? t('common.saving') : t('common.save')}
			</button>
			<button type="button" onClick={() => navigate(props.cancelTo)} disabled={props.saving}>
				{t('common.cancel')}
			</button>
			<Show when={props.onDelete}>
				<button
					type="button"
					class="btn-danger"
					onClick={() => props.onDelete?.()}
					disabled={props.saving}
				>
					{t('common.delete')}
				</button>
			</Show>
		</div>
	)
}

/**
 * Add/edit page shell: heading, the stacked form with the error line and
 * the create or save actions. Edit forms (`form.editing`) wait for the
 * record and report its `name` for the tab title and breadcrumb bar;
 * `crumbs` are the ancestors when the form belongs to another object (e.g.
 * the rack a shelf sits in).
 */
export function FormPage(props: {
	form: FormState
	title?: string
	onSubmit: (e: SubmitEvent) => void
	cancelTo: string
	name?: string
	crumbs?: readonly Crumb[]
	loadingText?: string
	/** Create forms: no "Create & Add Another". */
	singleton?: boolean
	/** Edit forms: adds a delete button. */
	onDelete?: () => void
	children: JSX.Element
}): JSX.Element {
	usePageMeta(() => ({ name: props.name, crumbs: props.crumbs }))
	return (
		<div class="form-page">
			<Show when={props.title}>
				<h2>{props.title}</h2>
			</Show>
			<Show
				when={props.form.loaded()}
				fallback={<Loading message={props.loadingText ?? t('common.loading')} />}
			>
				<form class="form-stacked" onSubmit={props.onSubmit}>
					{props.children}
					<InlineError message={props.form.error()} alert />
					<Show
						when={props.form.editing}
						fallback={
							<CreateActions
								saving={props.form.saving()}
								cancelTo={props.cancelTo}
								singleton={props.singleton}
							/>
						}
					>
						<EditActions
							saving={props.form.saving()}
							cancelTo={props.cancelTo}
							onDelete={props.onDelete}
						/>
					</Show>
				</form>
			</Show>
		</div>
	)
}
