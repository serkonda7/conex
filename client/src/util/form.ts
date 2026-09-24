/**
 * Shared logic behind the entity create forms: the name/slug auto-fill pair,
 * list-option loading that routes a failure into the form's error slot, and
 * the trim → validate → save → navigate flow.
 *
 * The matching markup lives in `../components/form`. Edit pages share the
 * same flow through `useEditForm` + `submit_edit` and the `EditPageShell` /
 * `EditActions` markup.
 */
import { Result } from 'better-result'
import { slugify } from 'shared/src/slug'
import { createSignal, type Setter } from 'solid-js'
import { navigate } from '../router'

/** Whether a form was submitted with the Create & Add Another action. */
export function is_add_another_submit(e: SubmitEvent): boolean {
	return (e.submitter as HTMLButtonElement | null)?.value === 'add-another'
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
		resetName: (): void => {
			setName('')
			setSlug('')
			setSlugTouched(false)
		},
	}
}

/**
 * Loads a paginated list for a form's `<select>` options. A failed fetch is
 * reported through the form's error slot and yields an empty option list, so
 * the rest of the form stays usable.
 */
export async function load_rows<T>(
	load: () => Promise<Result<{ items: T[] }, Error>>,
	setError: (message: string) => void,
): Promise<T[]> {
	const res = await load()
	if (Result.isError(res)) {
		setError(res.error.message)
		return []
	}
	return res.value.items
}

/** Trimmed name/slug pair handed to `SubmitFormOptions.save`. */
export interface FormValues {
	name: string
	slug: string
}

/** Options for {@link submit_form}. */
export interface SubmitFormOptions<T> {
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
	setError: (message: string | null) => void
	setSaving: (saving: boolean) => void
	/** Route opened after a successful save. */
	navigateTo: string
	/** Called instead of navigation for Create & Add Another. */
	onSuccess?: () => void
}

/**
 * Shared create/save flow: trims and requires the name (and the slug, when the
 * form has one), runs the form-specific checks, flips the saving flag, and
 * routes an API failure into the form's error slot or navigates away.
 */
export async function submit_form<T>(options: SubmitFormOptions<T>): Promise<void> {
	options.setError(null)
	const name = options.name.trim()
	if (!name && !options.optionalName) {
		options.setError(options.nameError ?? 'Name ist erforderlich.')
		return
	}
	let slug = ''
	if (options.slug !== undefined) {
		slug = options.slug.trim()
		if (!slug) {
			options.setError('Kurzname ist erforderlich.')
			return
		}
	}
	const invalid = options.validate?.() ?? null
	if (invalid !== null) {
		options.setError(invalid)
		return
	}
	options.setSaving(true)
	const res = await options.save({ name, slug })
	options.setSaving(false)
	if (Result.isError(res)) {
		options.setError(res.error.message)
		return
	}
	if (options.onSuccess) {
		options.onSuccess()
		return
	}
	navigate(options.navigateTo)
}

/** Error / saving / loaded signals shared by every entity edit form. */
export interface EditFormState {
	formError: () => string | null
	setFormError: Setter<string | null>
	saving: () => boolean
	setSaving: Setter<boolean>
	loaded: () => boolean
	setLoaded: Setter<boolean>
}

/** Creates the `formError` / `saving` / `loaded` signals of an edit form. */
export function useEditForm(): EditFormState {
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [loaded, setLoaded] = createSignal(false)
	return { formError, setFormError, saving, setSaving, loaded, setLoaded }
}

/** Options for {@link submit_edit}; mirrors {@link SubmitFormOptions}
 * without the Create & Add Another continuation. */
export interface SubmitEditOptions<T> {
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
	setError: (message: string | null) => void
	setSaving: (saving: boolean) => void
	/** Detail route opened after a successful save. */
	navigateTo: string
}

/**
 * Shared edit/save flow: the same trim → validate → save → navigate
 * sequence as `submit_form`, landing back on the detail page.
 */
export async function submit_edit<T>(options: SubmitEditOptions<T>): Promise<void> {
	await submit_form({
		name: options.name,
		optionalName: options.optionalName,
		nameError: options.nameError,
		slug: options.slug,
		validate: options.validate,
		save: options.save,
		setError: options.setError,
		setSaving: options.setSaving,
		navigateTo: options.navigateTo,
	})
}
