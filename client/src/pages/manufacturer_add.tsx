import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import { create_manufacturer } from '../api_templates'
import { FormActions, FormError, FormPage, NameField, TextField } from '../components/form'
import { navigate } from '../router'

/** /manufacturers/add — manufacturer create form. */
export function ManufacturerAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setFormError(null)
		if (!name().trim()) {
			setFormError('Name is required.')
			return
		}
		setSaving(true)
		const res = await create_manufacturer(name().trim(), description().trim() || undefined)
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/manufacturers')
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
				value={name()}
				onInput={setName}
				autofocus
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
