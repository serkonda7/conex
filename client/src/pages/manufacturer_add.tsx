import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import { create_manufacturer } from '../api_p3'
import {
	FormActions,
	FormError,
	FormPage,
	NameField,
	SlugField,
	TextField,
} from '../components/form'
import { type FormValues, submit_form, use_slug_fields } from '../util/form'

/** /manufacturers/add — manufacturer create form. */
export function ManufacturerAddPage(): JSX.Element {
	const slugFields = use_slug_fields()
	const [description, setDescription] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: slugFields.name(),
			slug: slugFields.slug(),
			save: (values: FormValues) =>
				create_manufacturer(values.name, values.slug, description().trim() || undefined),
			setError: setFormError,
			setSaving,
			navigateTo: '/manufacturers',
		})
	}

	return (
		<FormPage
			backTo="/manufacturers"
			backLabel="Manufacturers"
			title="Add a new manufacturer"
			onSubmit={handleCreate}
		>
			<NameField
				id="manufacturer-name"
				placeholder="Acme"
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus
			/>
			<SlugField
				id="manufacturer-slug"
				placeholder="acme"
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
			/>
			<TextField
				id="manufacturer-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/manufacturers" />
		</FormPage>
	)
}
