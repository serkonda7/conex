import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { fetch_tenant_group, update_tenant_group } from '../api_tenancy'
import {
	EditActions,
	EditPageShell,
	FormError,
	Hint,
	NameField,
	SlugField,
	TextAreaField,
	TextField,
} from '../components/form'
import { t } from '../i18n'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /tenant-groups/:id/edit — tenant group edit form. Saves back to the detail page. */
export function TenantGroupEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [group] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_tenant_group(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
			setDescription(res.value.description ?? '')
			setComments(res.value.comments ?? '')
			setLoaded(true)
			return res.value
		},
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: name(),
			slug: slug(),
			save: (values: FormValues) =>
				update_tenant_group(props.id, {
					name: values.name,
					slug: values.slug,
					description: description().trim() === '' ? null : description().trim(),
					comments: comments().trim() === '' ? null : comments().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/tenant-groups/${props.id}`,
		})
	}

	return (
		<EditPageShell
			name={group()?.name}
			title={t('tenantGroup.editTitle')}
			loaded={loaded()}
			loadingText={t('tenantGroup.loadingOne')}
			onSubmit={handleSave}
		>
			<NameField
				id="tenant-group-edit-name"
				placeholder={t('tenantGroup.namePlaceholder')}
				value={name()}
				onInput={setName}
			/>
			<SlugField
				id="tenant-group-edit-slug"
				placeholder={t('tenantGroup.slugPlaceholder')}
				value={slug()}
				onInput={setSlug}
				hint={<Hint>{t('form.slugHintEdit')}</Hint>}
			/>
			<TextField
				id="tenant-group-edit-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="tenant-group-edit-comments"
				label={t('common.comments')}
				placeholder={t('common.commentsPlaceholder')}
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/tenant-groups/${props.id}`} />
		</EditPageShell>
	)
}
