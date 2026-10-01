/**
 * Shared building blocks for the entity add/edit forms: the page shell with
 * its error line and action row, and labelled field wrappers.
 *
 * Field ids stay page-specific (`#site-name`, `#site-edit-name`, …) because
 * the e2e tests and the detail-page deep links address them directly.
 */

import { IconChevronDown, IconPlus } from '@tabler/icons-solidjs'
import type { InputEventAndTarget } from 'shared/src/types'
import { createEffect, createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js'
import { t } from '../i18n'
import type { FormState } from '../lib/form'
import { type Crumb, navigate, usePageMeta } from '../lib/router'
import { InlineError, Loading } from './feedback'

/** One `SelectField` entry. */
export interface FormOption {
	value: number | string
	label: string
}

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
	type?: 'text' | 'password' | 'number'
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

/** Required entity name input, optionally autofocused when the form mounts. */
export function NameField(props: {
	id: string
	placeholder: string
	value: string
	onInput: (value: string) => void
	autofocus?: boolean
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
	return (
		<TextField
			{...props}
			label={t('common.description')}
			placeholder={t('common.descriptionPlaceholder')}
			maxLength={500}
		/>
	)
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

/** "+" button beside a select that opens the add form of the selected kind. */
export function AddOptionButton(props: { label: string; href: string }): JSX.Element {
	const title = (): string => t('app.navAdd', { label: props.label })
	return (
		<button
			type="button"
			class="icon-btn btn-add"
			aria-label={title()}
			title={title()}
			onClick={() => navigate(props.href)}
		>
			<IconPlus size={16} />
		</button>
	)
}

/** Searchable dropdown of `options`, with an optional leading empty choice.
 * A text combobox: typing filters the options by label, arrow keys move the
 * highlight, Enter picks it. The input shows the selected label while closed;
 * the numeric value sits in `data-value` for e2e tests. */
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
	action?: JSX.Element
}): JSX.Element {
	let list: HTMLDivElement | undefined
	const ref = useAutofocus(() => props.autofocus)
	const listId = `${props.id}-listbox`
	const [open, setOpen] = createSignal(false)
	const [query, setQuery] = createSignal('')
	const [active, setActive] = createSignal(0)

	const choices = createMemo((): FormOption[] =>
		props.emptyLabel === undefined
			? props.options
			: [{ value: '', label: props.emptyLabel }, ...props.options],
	)
	const selected = createMemo(() =>
		props.value === '' ? undefined : choices().find((o) => String(o.value) === props.value),
	)
	const filtered = createMemo((): FormOption[] => {
		const needle = query().trim().toLowerCase()
		return needle === ''
			? choices()
			: choices().filter((o) => o.label.toLowerCase().includes(needle))
	})
	const editable = (): boolean => !props.disabled && props.onChange !== undefined

	createEffect(() => {
		// Keep the highlighted option visible while arrowing through a long list.
		if (open()) {
			list?.querySelector(`[data-index="${active()}"]`)?.scrollIntoView({ block: 'nearest' })
		}
	})

	function show(): void {
		if (open() || !editable()) {
			return
		}
		setQuery('')
		const index = choices().findIndex((o) => String(o.value) === props.value)
		setActive(Math.max(index, 0))
		setOpen(true)
	}

	function pick(option: FormOption | undefined): void {
		setOpen(false)
		if (option && String(option.value) !== props.value) {
			props.onChange?.(String(option.value))
		}
	}

	function step(delta: number): void {
		const count = filtered().length
		if (!open()) {
			show()
		} else if (count > 0) {
			setActive((active() + delta + count) % count)
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault()
			step(e.key === 'ArrowDown' ? 1 : -1)
			return
		}
		if (!open()) {
			return
		}
		if (e.key === 'Enter') {
			e.preventDefault()
			pick(filtered()[active()])
		} else if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			setOpen(false)
		}
	}

	const placeholder = (): string | undefined =>
		open() ? (selected()?.label ?? props.emptyLabel ?? t('common.search')) : props.emptyLabel

	return (
		<Field label={props.label} for={props.id} required={props.required} hint={props.hint}>
			<div class="field-inline-actions">
				<div class="combobox" classList={{ 'combobox-open': open() }}>
					<input
						id={props.id}
						ref={ref}
						role="combobox"
						aria-expanded={open()}
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={
							open() && filtered().length > 0
								? `${props.id}-option-${active()}`
								: undefined
						}
						aria-describedby={props.describedBy}
						autocomplete="off"
						required={props.required}
						disabled={props.disabled}
						readOnly={props.onChange === undefined}
						data-autofocus={props.autofocus || undefined}
						data-value={props.value}
						placeholder={placeholder()}
						value={open() ? query() : (selected()?.label ?? '')}
						onClick={show}
						onInput={(e: InputEventAndTarget) => {
							show()
							setQuery(e.currentTarget.value)
							setActive(0)
						}}
						onKeyDown={onKeyDown}
						onBlur={() => setOpen(false)}
					/>
					<IconChevronDown class="combobox-chevron" size={16} aria-hidden="true" />
					<Show when={open()}>
						<div class="combobox-list" id={listId} ref={list} role="listbox">
							<For
								each={filtered()}
								fallback={
									<div class="combobox-empty">
										{t('common.noMatchingObjects')}
									</div>
								}
							>
								{(option: FormOption, index: () => number): JSX.Element => (
									// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection runs through the combobox input (aria-activedescendant)
									// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox input
									<div
										id={`${props.id}-option-${index()}`}
										data-index={index()}
										role="option"
										aria-selected={String(option.value) === props.value}
										classList={{
											'combobox-option': true,
											'combobox-option-active': index() === active(),
											'combobox-option-empty': option.value === '',
										}}
										// Keep focus in the input so blur doesn't close the list first.
										onMouseDown={(e: MouseEvent) => e.preventDefault()}
										onMouseMove={() => setActive(index())}
										onClick={() => pick(option)}
									>
										{option.label}
									</div>
								)}
							</For>
						</div>
					</Show>
				</div>
				{props.action}
			</div>
		</Field>
	)
}

/** Create actions. Cancel closes the tab without refreshing so the list
 * behind it keeps its exact contents; `singleton` drops "Create & Add
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
				onClick={() => navigate(props.cancelTo, { refresh: false })}
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
	title: string
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
			<h2>{props.title}</h2>
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
