import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { fetch_manufacturer, update_manufacturer } from '../api_templates'
import { EditActions, EditPageShell, FormError, NameField, TextField } from '../components/form'
import { t, tp } from '../i18n'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /manufacturers/:id/edit — manufacturer edit form. Saves back to the detail page. */
export function ManufacturerEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [manufacturer] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_manufacturer(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setDescription(res.value.description ?? '')
			setLoaded(true)
			return res.value
		},
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: name(),
			save: (values: FormValues) =>
				update_manufacturer(props.id, {
					name: values.name,
					description: description().trim() === '' ? null : description().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/manufacturers/${props.id}`,
		})
	}

	return (
		<EditPageShell
			backTo={`/manufacturers/${props.id}`}
			backLabel={manufacturer()?.name ?? tp('entity.manufacturer', 1)}
			title={t('manufacturer.editTitle')}
			loaded={loaded()}
			loadingText={t('manufacturer.loadingOne')}
			onSubmit={handleSave}
		>
			<NameField
				id="manufacturer-edit-name"
				placeholder={t('manufacturer.namePlaceholder')}
				value={name()}
				onInput={setName}
			/>
			<TextField
				id="manufacturer-edit-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/manufacturers/${props.id}`} />
		</EditPageShell>
	)
}
