import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { create_site_group, fetch_site_groups, fetch_tenants } from '../api_tenancy'
import {
	FormActions,
	FormError,
	FormPage,
	NameField,
	row_options,
	SelectField,
	SlugField,
	TextAreaField,
	TextField,
} from '../components/form'
import {
	type FormValues,
	is_add_another_submit,
	load_rows,
	submit_form,
	use_slug_fields,
} from '../util/form'

/** /site-groups/add — NetBox-style site group create form. */
export function SiteGroupAddPage(): JSX.Element {
	const slugFields = use_slug_fields()
	const [parentId, setParentId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [groups] = createResource(() => load_rows(fetch_site_groups, setFormError))
	const [tenants] = createResource(() => load_rows(fetch_tenants, setFormError))

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: slugFields.name(),
			slug: slugFields.slug(),
			save: (values: FormValues) =>
				create_site_group({
					name: values.name,
					slug: values.slug,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					parent_id: parentId() ? Number(parentId()) : null,
					description: description().trim() || undefined,
					comments: comments().trim() || undefined,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/site-groups',
			onSuccess: is_add_another_submit(e) ? slugFields.resetName : undefined,
		})
	}

	return (
		<FormPage
			backTo="/site-groups"
			backLabel="Site Groups"
			title="Add a new site group"
			onSubmit={handleCreate}
		>
			<NameField
				id="site-group-name"
				placeholder="US East"
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus
			/>
			<SlugField
				id="site-group-slug"
				placeholder="us-east"
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
			/>
			<SelectField
				id="site-group-tenant"
				label="Tenant"
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel="No tenant"
			/>
			<SelectField
				id="site-group-parent"
				label="Parent"
				value={parentId()}
				onChange={setParentId}
				options={row_options(groups() ?? [])}
				emptyLabel="Top level"
			/>
			<TextField
				id="site-group-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="site-group-comments"
				label="Comments"
				placeholder="Additional notes (optional)"
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/site-groups" />
		</FormPage>
	)
}
