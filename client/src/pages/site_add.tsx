import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, Show } from 'solid-js'
import { create_site, fetch_site_groups, fetch_tenants, type SiteGroupRow } from '../api_p1'
import {
	FormActions,
	FormError,
	FormPage,
	Hint,
	NameField,
	row_options,
	SelectField,
	SlugField,
	TextAreaField,
	TextField,
} from '../components/form'
import { parseId, queryParam } from '../router'
import {
	type FormValues,
	is_add_another_submit,
	load_rows,
	submit_form,
	use_slug_fields,
} from '../util/form'

/** /sites/add — NetBox-style site create form. */
export function SiteAddPage(): JSX.Element {
	const slugFields = use_slug_fields()
	const [tenantId, setTenantId] = createSignal(queryParam('tenant'))
	const [tenantTouched, setTenantTouched] = createSignal(queryParam('tenant') !== '')
	const [groupId, setGroupId] = createSignal(queryParam('group'))
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [physicalAddress, setPhysicalAddress] = createSignal('')
	const [shippingAddress, setShippingAddress] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [tenants] = createResource(() => load_rows(fetch_tenants, setFormError))
	const [groups] = createResource(() => load_rows(fetch_site_groups, setFormError))

	// Tenant defaults to the selected group's tenant until the user picks one
	// explicitly (or `?tenant=` is present, which counts as explicit).
	const groupTenantId = createMemo(() => {
		const id = parseId(groupId())
		if (id === null) {
			return null
		}
		return (groups() ?? []).find((g: SiteGroupRow) => g.id === id)?.tenant_id ?? null
	})

	createEffect(() => {
		if (tenantTouched()) {
			return
		}
		if (groups() === undefined) {
			return
		}
		const tenant = groupTenantId()
		setTenantId(tenant ? String(tenant) : '')
	})

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: slugFields.name(),
			slug: slugFields.slug(),
			save: (values: FormValues) =>
				create_site({
					name: values.name,
					slug: values.slug,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					site_group_id: groupId() ? Number(groupId()) : null,
					description: description().trim() || undefined,
					comments: comments().trim() || undefined,
					physical_address: physicalAddress().trim() || undefined,
					shipping_address: shippingAddress().trim() || undefined,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/sites',
			onSuccess: is_add_another_submit(e) ? slugFields.resetName : undefined,
		})
	}

	return (
		<FormPage backTo="/sites" backLabel="Sites" title="Add a new site" onSubmit={handleCreate}>
			<NameField
				id="site-name"
				placeholder="New York DC"
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus
			/>
			<SlugField
				id="site-slug"
				placeholder="new-york-dc"
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
			/>
			<SelectField
				id="site-tenant"
				label="Tenant"
				value={tenantId()}
				onChange={(value: string): void => {
					setTenantTouched(true)
					setTenantId(value)
				}}
				options={row_options(tenants() ?? [])}
				emptyLabel="No tenant"
				hint={
					<Show when={!tenantTouched() && groupTenantId() !== null}>
						<Hint>Defaults to the group's tenant.</Hint>
					</Show>
				}
			/>
			<SelectField
				id="site-group"
				label="Group"
				value={groupId()}
				onChange={setGroupId}
				options={row_options(groups() ?? [])}
				emptyLabel="No group"
			/>
			<TextField
				id="site-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="site-comments"
				label="Comments"
				placeholder="Additional notes (optional)"
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<TextAreaField
				id="site-physical-address"
				label="Physical address"
				placeholder="Street, city, … (optional)"
				rows={3}
				maxLength={500}
				value={physicalAddress()}
				onInput={setPhysicalAddress}
			/>
			<TextAreaField
				id="site-shipping-address"
				label="Shipping address"
				placeholder="Receiving dock, … (optional)"
				rows={3}
				maxLength={500}
				value={shippingAddress()}
				onInput={setShippingAddress}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/sites" />
		</FormPage>
	)
}
