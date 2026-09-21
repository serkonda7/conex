/**
 * Shared logic behind the entity create forms: the name/slug auto-fill pair,
 * list-option loading that routes a failure into the form's error slot, and
 * the trim → validate → save → navigate flow.
 *
 * The matching markup lives in `../components/form`.
 */
import { Result } from 'better-result'
import { slugify } from 'shared/src/slug'
import { createSignal } from 'solid-js'
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
	if (!name) {
		options.setError(options.nameError ?? 'Name is required.')
		return
	}
	let slug = ''
	if (options.slug !== undefined) {
		slug = options.slug.trim()
		if (!slug) {
			options.setError('Slug is required.')
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
