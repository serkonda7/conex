import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, Show } from 'solid-js'
import {
	create_location,
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type SiteRow,
} from '../api_p1'
import {
	FormActions,
	FormError,
	FormPage,
	Hint,
	NameField,
	row_options,
	SelectField,
	SlugField,
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

/** /locations/add — NetBox-style location create form. */
export function LocationAddPage(): JSX.Element {
	const slugFields = use_slug_fields()
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [parentId, setParentId] = createSignal('')
	const [tenantId, setTenantId] = createSignal(queryParam('tenant'))
	const [tenantTouched, setTenantTouched] = createSignal(queryParam('tenant') !== '')
	const [description, setDescription] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [sites] = createResource(() => load_rows(fetch_sites, setFormError))
	const [tenants] = createResource(() => load_rows(fetch_tenants, setFormError))

	// Parent options belong to a site, so they follow the site picker.
	const [parents] = createResource(siteId, async (site: string) => {
		const id = parseId(site)
		if (id === null) {
			return []
		}
		return load_rows(() => fetch_locations({ site: id }), setFormError)
	})

	const parentOptions = createMemo(() => parents() ?? [])

	// If a tenant is picked, only offer that tenant's sites.
	const filteredSites = createMemo(() => {
		const all = sites() ?? []
		// The tenant is also derived from a selected site's tenant. Do not
		// rebuild the site options for that implicit value: replacing the
		// options causes the browser to reset the selected site.
		if (!tenantTouched()) {
			return all
		}
		const tenant = parseId(tenantId())
		if (tenant === null) {
			return all
		}
		return all.filter((s: SiteRow) => s.tenant_id === tenant)
	})

	// Tenant defaults to the selected site's tenant until the user picks one
	// explicitly (or `?tenant=` is present, which counts as explicit).
	const siteTenantId = createMemo(() => {
		const id = parseId(siteId())
		if (id === null) {
			return null
		}
		return (sites() ?? []).find((s: SiteRow) => s.id === id)?.tenant_id ?? null
	})

	createEffect(() => {
		if (tenantTouched()) {
			return
		}
		if (sites() === undefined) {
			return
		}
		const tenant = siteTenantId()
		setTenantId(tenant ? String(tenant) : '')
	})

	// Enforce the tenant → sites filter for explicit tenant choices (including
	// `?tenant=` deep links): drop a selected site that belongs to another
	// tenant once the site list is known.
	createEffect(() => {
		const all = sites()
		if (all === undefined) {
			return
		}
		if (!tenantTouched()) {
			return
		}
		const tenant = parseId(tenantId())
		if (tenant === null) {
			return
		}
		const site = parseId(siteId())
		if (site === null) {
			return
		}
		const current = all.find((s: SiteRow) => s.id === site)
		if (current && current.tenant_id !== tenant) {
			setSiteId('')
			setParentId('')
		}
	})

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setParentId('')
	}

	function handleTenantChange(value: string): void {
		setTenantTouched(true)
		setTenantId(value)
		const tenant = parseId(value)
		if (tenant === null) {
			return
		}
		const site = parseId(siteId())
		if (site === null) {
			return
		}
		const current = (sites() ?? []).find((s: SiteRow) => s.id === site)
		if (current && current.tenant_id !== tenant) {
			setSiteId('')
			setParentId('')
		}
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: slugFields.name(),
			slug: slugFields.slug(),
			validate: () => (parseId(siteId()) === null ? 'Select a site first.' : null),
			save: (values: FormValues) =>
				create_location({
					name: values.name,
					slug: values.slug,
					site_id: Number(siteId()),
					parent_id: parentId() ? Number(parentId()) : null,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					description: description().trim() || undefined,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/locations',
			onSuccess: is_add_another_submit(e) ? slugFields.resetName : undefined,
		})
	}

	return (
		<FormPage
			backTo="/locations"
			backLabel="Locations"
			title="Add a new location"
			onSubmit={handleCreate}
		>
			<NameField
				id="location-name"
				placeholder="Floor 2"
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus
			/>
			<SlugField
				id="location-slug"
				placeholder="floor-2"
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
			/>
			<SelectField
				id="location-site"
				label="Site"
				required
				value={siteId()}
				onChange={handleSiteChange}
				options={row_options(filteredSites())}
				emptyLabel="Site…"
				hint={
					<Show when={parseId(tenantId()) !== null}>
						<Hint>Showing only sites for the selected tenant.</Hint>
					</Show>
				}
			/>
			<SelectField
				id="location-parent"
				label="Parent"
				value={parentId()}
				disabled={siteId() === ''}
				onChange={setParentId}
				options={row_options(parentOptions())}
				emptyLabel="Top level"
				hint={
					<Show when={siteId() === ''}>
						<Hint>Pick a site first to choose a parent.</Hint>
					</Show>
				}
			/>
			<SelectField
				id="location-tenant"
				label="Tenant"
				value={tenantId()}
				onChange={handleTenantChange}
				options={row_options(tenants() ?? [])}
				emptyLabel="No tenant"
				hint={
					<Show when={!tenantTouched() && siteTenantId() !== null}>
						<Hint>Defaults to the site's tenant.</Hint>
					</Show>
				}
			/>
			<TextField
				id="location-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/locations" />
		</FormPage>
	)
}
