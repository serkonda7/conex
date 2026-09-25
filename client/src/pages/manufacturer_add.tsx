import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import { create_manufacturer } from '../api_templates'
import { FormActions, FormError, FormPage, NameField, TextField } from '../components/form'
import { t, tp } from '../i18n'
import { navigate } from '../router'
import { is_add_another_submit } from '../util/form'

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
			setFormError(t('form.nameRequired'))
			return
		}
		setSaving(true)
		const res = await create_manufacturer(name().trim(), description().trim() || undefined)
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		if (is_add_another_submit(e)) {
			setName('')
			setDescription('')
			return
		}
		navigate('/manufacturers')
	}

	return (
		<FormPage
			backTo="/manufacturers"
			backLabel={tp('entity.manufacturer', 2)}
			title={t('manufacturer.addTitle')}
			onSubmit={handleCreate}
		>
			<NameField
				id="manufacturer-name"
				placeholder={t('manufacturer.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus
			/>
			<TextField
				id="manufacturer-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/manufacturers" />
		</FormPage>
	)
}
