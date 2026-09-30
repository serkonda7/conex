/**
 * Shared logic behind the entity add/edit forms: the error/saving/loaded
 * state, loading the record of an edit form, the name/slug auto-fill pair,
 * value conversion for the API bodies, and the trim → validate → save →
 * navigate flow.
 *
 * The matching markup lives in `../components/form`.
 */
import { Result } from 'better-result'
import { slugify } from 'shared/src/slug'
import { createResource, createSignal, type Resource, type Setter } from 'solid-js'
import { t } from '../i18n'
import { navigate } from './router'

/** Whether a form was submitted with the Create & Add Another action. */
export function is_add_another_submit(e: SubmitEvent): boolean {
	return (e.submitter as HTMLButtonElement | null)?.value === 'add-another'
}

/** Trimmed text, or `undefined` when blank (create bodies omit the field). */
export function text(value: string): string | undefined {
	const trimmed = value.trim()
	return trimmed === '' ? undefined : trimmed
}

/** A nullable id as a `<select>` value (`''` = none). */
export function id_value(id: number | null | undefined): string {
	return id === null || id === undefined ? '' : String(id)
}

type Cleared<T> = {
	[K in keyof T]: undefined extends T[K] ? Exclude<T[K], undefined> | null : T[K]
}

/**
 * Turns a create body into an update patch: omitted (blank) fields become
 * `null`, so saving an edit form clears them on the server.
 */
export function cleared<T extends object>(body: T): Cleared<T> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(body)) {
		out[key] = value === undefined ? null : value
	}
	return out as Cleared<T>
}

/** Accessors for the name/slug pair of an entity form. */
export interface SlugFields {
	/** Current name value. */
	name: () => string
	/** Current slug value; follows the name until the slug is edited. */
	slug: () => string
	/** Name input handler: mirrors the slug while it is untouched. */
	handleNameInput: (value: string) => void
	/** Slug input handler: marks the slug as user-owned. */
	handleSlugInput: (value: string) => void
	/** Fills both from a loaded record; the slug no longer follows the name. */
	fill: (name: string, slug: string) => void
	/** Clears only the name and slug for the next item. */
	resetName: () => void
}

/**
 * Name/slug signals with the shared auto-fill rule: typing the name mirrors
 * the slug until the slug itself is edited.
 */
export function use_slug_fields(): SlugFields {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [slugTouched, setSlugTouched] = createSignal(false)

	return {
		name,
		slug,
		handleNameInput: (value: string): void => {
			setName(value)
			if (!slugTouched()) {
				setSlug(slugify(value))
			}
		},
		handleSlugInput: (value: string): void => {
			setSlugTouched(true)
			setSlug(value)
		},
		fill: (nextName: string, nextSlug: string): void => {
			setName(nextName)
			setSlug(nextSlug)
			setSlugTouched(true)
		},
		resetName: (): void => {
			setName('')
			setSlug('')
			setSlugTouched(false)
		},
	}
}

/** Error / saving / loaded signals shared by every entity form. */
export interface FormState {
	/** True on edit forms (an `id` was given). */
	editing: boolean
	error: () => string | null
	setError: Setter<string | null>
	saving: () => boolean
	setSaving: Setter<boolean>
	/** Create forms start loaded; edit forms once the record is filled in. */
	loaded: () => boolean
}

/** Creates the state of a create form (no record to load). */
export function useFormState(): FormState {
	const [error, setError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	return { editing: false, error, setError, saving, setSaving, loaded: () => true }
}

/** {@link FormState} of a form that edits the record `id`, or creates one when omitted. */
export interface EntityFormState<T> extends FormState {
	/** The loaded record; stays undefined on create forms. */
	record: Resource<T | null>
}

/**
 * State of a combined add/edit form. With an `id`, the record is loaded
 * once, handed to `fill` to seed the field signals, and the form counts as
 * loaded; a failed load lands in the form's error slot.
 */
export function useEntityForm<T>(opts: {
	id: number | undefined
	load: (id: number) => Promise<Result<T, Error>>
	fill: (row: T) => void
}): EntityFormState<T> {
	const base = useFormState()
	const [loaded, setLoaded] = createSignal(opts.id === undefined)
	const [record] = createResource(
		() => opts.id,
		async (id: number): Promise<T | null> => {
			const res = await opts.load(id)
			if (Result.isError(res)) {
				base.setError(res.error.message)
				return null
			}
			opts.fill(res.value)
			setLoaded(true)
			return res.value
		},
	)
	return { ...base, editing: opts.id !== undefined, loaded, record }
}

/** Trimmed name/slug pair handed to `SubmitFormOptions.save`. */
export interface FormValues {
	name: string
	slug: string
}

/** Options for {@link submit_form}. */
export interface SubmitFormOptions<T> {
	form: FormState
	/** Raw name value; trimmed and required. */
	name: string
	/** Allow an empty name for entities that have a display fallback. */
	optionalName?: boolean
	/** Overrides the default "Name is required." message. */
	nameError?: string
	/** Raw slug value; omit on forms without a slug. */
	slug?: string
	/** Form-specific checks; return a message to abort the submit. */
	validate?: () => string | null
	/** Persists the entity using the trimmed name and slug. */
	save: (values: FormValues) => Promise<Result<T, Error>>
	/** Route opened after a successful save. */
	navigateTo: string
	/** Called instead of navigation for Create & Add Another. */
	onSuccess?: () => void
}

/** The first failed check, or null when the name, slug and form checks pass. */
function invalid<T>(opts: SubmitFormOptions<T>, values: FormValues): string | null {
	if (!values.name && opts.optionalName !== true) {
		return opts.nameError ?? t('form.nameRequired')
	}
	if (opts.slug !== undefined && !values.slug) {
		return t('form.slugRequired')
	}
	return opts.validate?.() ?? null
}

/**
 * Shared create/save flow: trims and requires the name (and the slug, when the
 * form has one), runs the form-specific checks, flips the saving flag, and
 * routes an API failure into the form's error slot or navigates away.
 */
export async function submit_form<T>(opts: SubmitFormOptions<T>): Promise<void> {
	const { form } = opts
	form.setError(null)
	const values = { name: opts.name.trim(), slug: opts.slug?.trim() ?? '' }
	const problem = invalid(opts, values)
	if (problem !== null) {
		form.setError(problem)
		return
	}
	form.setSaving(true)
	const res = await opts.save(values)
	form.setSaving(false)
	if (Result.isError(res)) {
		form.setError(res.error.message)
		return
	}
	if (opts.onSuccess) {
		opts.onSuccess()
		return
	}
	navigate(opts.navigateTo)
}
