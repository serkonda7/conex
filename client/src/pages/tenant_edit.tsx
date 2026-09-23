import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { fetch_tenant, update_tenant } from '../api_tenancy'
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
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /tenants/:id/edit — tenant edit form. Saves back to the detail page. */
export function TenantEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [tenant] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_tenant(id)
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
				update_tenant(props.id, {
					name: values.name,
					slug: values.slug,
					description: description().trim() === '' ? null : description().trim(),
					comments: comments().trim() === '' ? null : comments().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/tenants/${props.id}`,
		})
	}

	return (
		<EditPageShell
			backTo={`/tenants/${props.id}`}
			backLabel={tenant()?.name ?? 'Tenant'}
			title="Edit tenant"
			loaded={loaded()}
			loadingText="Loading tenant…"
			onSubmit={handleSave}
		>
			<NameField
				id="tenant-edit-name"
				placeholder="Acme Corp"
				value={name()}
				onInput={setName}
			/>
			<SlugField
				id="tenant-edit-slug"
				placeholder="acme-corp"
				value={slug()}
				onInput={setSlug}
				hint={<Hint>URL-safe identifier: lowercase letters, digits, single dashes.</Hint>}
			/>
			<TextField
				id="tenant-edit-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="tenant-edit-comments"
				label="Comments"
				placeholder="Additional notes (optional)"
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/tenants/${props.id}`} />
		</EditPageShell>
	)
}
