import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import {
	fetch_site_group,
	fetch_site_groups,
	fetch_tenants,
	update_site_group,
} from '../api_tenancy'
import {
	EditActions,
	EditPageShell,
	FormError,
	Hint,
	NameField,
	row_options,
	SelectField,
	SlugField,
	TextAreaField,
	TextField,
} from '../components/form'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /site-groups/:id/edit — site group edit form. Saves back to the detail page. */
export function SiteGroupEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [parentId, setParentId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [groups] = createResource(async () => {
		const res = await fetch_site_groups()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [group] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_site_group(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setParentId(res.value.parent_id ? String(res.value.parent_id) : '')
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
				update_site_group(props.id, {
					name: values.name,
					slug: values.slug,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					parent_id: parentId() ? Number(parentId()) : null,
					description: description().trim() === '' ? null : description().trim(),
					comments: comments().trim() === '' ? null : comments().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/site-groups/${props.id}`,
		})
	}

	return (
		<EditPageShell
			backTo={`/site-groups/${props.id}`}
			backLabel={group()?.name ?? 'Site group'}
			title="Edit site group"
			loaded={loaded()}
			loadingText="Loading site group…"
			onSubmit={handleSave}
		>
			<NameField
				id="site-group-edit-name"
				placeholder="US East"
				value={name()}
				onInput={setName}
			/>
			<SlugField
				id="site-group-edit-slug"
				placeholder="us-east"
				value={slug()}
				onInput={setSlug}
				hint={<Hint>URL-safe identifier: lowercase letters, digits, single dashes.</Hint>}
			/>
			<SelectField
				id="site-group-edit-tenant"
				label="Tenant"
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel="No tenant"
			/>
			<SelectField
				id="site-group-edit-parent"
				label="Parent"
				value={parentId()}
				onChange={setParentId}
				options={row_options((groups() ?? []).filter((g) => g.id !== props.id))}
				emptyLabel="Top level"
			/>
			<TextField
				id="site-group-edit-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="site-group-edit-comments"
				label="Comments"
				placeholder="Additional notes (optional)"
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/site-groups/${props.id}`} />
		</EditPageShell>
	)
}
