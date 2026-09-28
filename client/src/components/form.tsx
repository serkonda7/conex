/**
 * Shared building blocks for the entity create forms: the page shell,
 * labelled field wrappers, and the submit/cancel action row.
 *
 * Field ids stay page-specific (`#site-name`, …) because the e2e smoke test
 * and the detail-page deep links address them directly.
 */

import { IconChevronDown } from '@tabler/icons-solidjs'
import type { InputEventAndTarget } from 'shared/src/types'
import { createEffect, createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js'
import { t } from '../i18n'
import { type Crumb, navigate, usePageMeta } from '../router'
import { Loading } from './feedback'

/** One `SelectField` entry. */
export interface FormOption {
	value: number | string
	label: string
}

/** Maps list rows (`{ id, name }`) to `SelectField` options. */
export function row_options(rows: { id: number; name: string }[]): FormOption[] {
	return rows.map((row) => ({ value: row.id, label: row.name }))
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
				max={props.max}
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
	let input: HTMLInputElement | undefined
	let list: HTMLDivElement | undefined
	const listId = `${props.id}-listbox`
	const [open, setOpen] = createSignal(false)
	const [query, setQuery] = createSignal('')
	const [active, setActive] = createSignal(0)

	onMount(() => {
		if (props.autofocus ?? false) {
			input?.focus()
		}
	})

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

	function onKeyDown(e: KeyboardEvent): void {
		const count = filtered().length
		switch (e.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				e.preventDefault()
				if (!open()) {
					show()
				} else if (count > 0) {
					const step = e.key === 'ArrowDown' ? 1 : -1
					setActive((active() + step + count) % count)
				}
				break
			case 'Enter':
				if (open()) {
					e.preventDefault()
					pick(filtered()[active()])
				}
				break
			case 'Escape':
				if (open()) {
					e.preventDefault()
					e.stopPropagation()
					setOpen(false)
				}
				break
		}
	}

	return (
		<Field label={props.label} for={props.id} required={props.required} hint={props.hint}>
			<div class="field-inline-actions">
				<div class="combobox" classList={{ 'combobox-open': open() }}>
					<input
						id={props.id}
						ref={input}
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
						placeholder={
							open()
								? (selected()?.label ?? props.emptyLabel ?? t('common.search'))
								: props.emptyLabel
						}
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
		<Field label={t('common.name')} for={props.id} required>
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

/** Required URL slug input, pattern-checked against `SlugSchema`. The default
 * hint notes the slug is auto-filled from the name. */
export function SlugField(props: {
	id: string
	placeholder: string
	value: string
	onInput: (value: string) => void
	/** Overrides the auto-fill hint (edit forms use the shorter variant). */
	hint?: JSX.Element
}): JSX.Element {
	return (
		<Field
			label={t('common.slug')}
			for={props.id}
			required
			hint={props.hint ?? <Hint>{t('form.slugHint')}</Hint>}
		>
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
				{t('common.cancel')}
			</button>
			<button type="submit" name="action" value="create" disabled={props.saving}>
				{props.saving ? t('common.creating') : t('common.create')}
			</button>
			<button type="submit" name="action" value="add-another" disabled={props.saving}>
				{t('common.createAndAddAnother')}
			</button>
		</div>
	)
}

/**
 * Create-page shell: heading and the stacked form. `crumbs` are the
 * ancestors for the breadcrumb bar when the form belongs to another object
 * (e.g. the rack a shelf is added to).
 */
export function FormPage(props: {
	crumbs?: readonly Crumb[]
	title: string
	onSubmit: (e: SubmitEvent) => void
	children: JSX.Element
}): JSX.Element {
	usePageMeta(() => ({ crumbs: props.crumbs }))
	return (
		<div class="form-page">
			<h2>{props.title}</h2>
			<form class="form-stacked" onSubmit={props.onSubmit}>
				{props.children}
			</form>
		</div>
	)
}

/** Edit actions, disabled while the form is saving. Save navigates back to
 * the detail page; cancel returns without forcing a refresh. */
export function EditActions(props: {
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
 * Edit-page shell: heading and the stacked form gated on the loaded flag.
 * `name` is the entity name once loaded, for the tab title and breadcrumb
 * bar; `crumbs` its ancestors when the page has no detail page to borrow
 * them from. `loadingText` preserves each page's exact skeleton string.
 */
export function EditPageShell(props: {
	name: string | undefined
	crumbs?: readonly Crumb[]
	title: string
	loaded: boolean
	loadingText: string
	onSubmit: (e: SubmitEvent) => void
	children: JSX.Element
}): JSX.Element {
	usePageMeta(() => ({ name: props.name, crumbs: props.crumbs }))
	return (
		<div class="form-page">
			<h2>{props.title}</h2>
			<Show when={props.loaded} fallback={<Loading message={props.loadingText} />}>
				<form class="form-stacked" onSubmit={props.onSubmit}>
					{props.children}
				</form>
			</Show>
		</div>
	)
}
