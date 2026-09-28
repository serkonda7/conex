import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import { create_tenant_group } from '../api_tenancy'
import {
	FormActions,
	FormError,
	FormPage,
	NameField,
	SlugField,
	TextAreaField,
	TextField,
} from '../components/form'
import { t } from '../i18n'
import { type FormValues, is_add_another_submit, submit_form, use_slug_fields } from '../util/form'

/** /tenant-groups/add — tenant group create form. */
export function TenantGroupAddPage(): JSX.Element {
	const slugFields = use_slug_fields()
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: slugFields.name(),
			slug: slugFields.slug(),
			save: (values: FormValues) =>
				create_tenant_group({
					name: values.name,
					slug: values.slug,
					description: description().trim() || undefined,
					comments: comments().trim() || undefined,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/tenant-groups',
			onSuccess: is_add_another_submit(e) ? slugFields.resetName : undefined,
		})
	}

	return (
		<FormPage title={t('tenantGroup.addTitle')} onSubmit={handleCreate}>
			<NameField
				id="tenant-group-name"
				placeholder={t('tenantGroup.namePlaceholder')}
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus
			/>
			<SlugField
				id="tenant-group-slug"
				placeholder={t('tenantGroup.slugPlaceholder')}
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
			/>
			<TextField
				id="tenant-group-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="tenant-group-comments"
				label={t('common.comments')}
				placeholder={t('common.commentsPlaceholder')}
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/tenant-groups" />
		</FormPage>
	)
}
