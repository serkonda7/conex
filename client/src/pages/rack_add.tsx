import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, Show } from 'solid-js'
import { fetch_locations, fetch_sites, fetch_tenants, type SiteRow } from '../api_p1'
import { create_rack } from '../api_p2'
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

/** Id of the hint under the disabled rack-type select. */
const RACK_TYPE_HINT_ID = 'rack-type-hint'

/** /racks/add — NetBox-style rack create form. */
export function RackAddPage(): JSX.Element {
	const slugFields = use_slug_fields()
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [locationId, setLocationId] = createSignal(queryParam('location'))
	const [tenantId, setTenantId] = createSignal(queryParam('tenant'))
	const [tenantTouched, setTenantTouched] = createSignal(queryParam('tenant') !== '')
	const [description, setDescription] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [sites] = createResource(() => load_rows(fetch_sites, setFormError))
	const [tenants] = createResource(() => load_rows(fetch_tenants, setFormError))

	// Tenant defaults to the selected site's tenant until the user picks one
	// explicitly (or `?tenant=` is present, which counts as explicit).
	const siteTenantId = createMemo(() => {
		const id = parseId(siteId())
		if (id === null) {
			return null
		}
		return (sites() ?? []).find((site: SiteRow) => site.id === id)?.tenant_id ?? null
	})

	createEffect(() => {
		if (tenantTouched() || sites() === undefined) {
			return
		}
		const tenant = siteTenantId()
		setTenantId(tenant ? String(tenant) : '')
	})

	// Location options belong to a site, so they follow the site picker.
	const [locations] = createResource(siteId, async (site: string) => {
		const id = parseId(site)
		if (id === null) {
			return []
		}
		return load_rows(() => fetch_locations({ site: id }), setFormError)
	})

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setLocationId('')
	}

	function handleTenantChange(value: string): void {
		setTenantTouched(true)
		setTenantId(value)
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: slugFields.name(),
			slug: slugFields.slug(),
			validate: () => (parseId(siteId()) === null ? 'Select a site first.' : null),
			save: (values: FormValues) =>
				create_rack({
					name: values.name,
					slug: values.slug,
					site_id: Number(siteId()),
					location_id: locationId() ? Number(locationId()) : null,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					description: description().trim() || undefined,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/racks',
			onSuccess: is_add_another_submit(e) ? slugFields.resetName : undefined,
		})
	}

	return (
		<FormPage backTo="/racks" backLabel="Racks" title="Add a new rack" onSubmit={handleCreate}>
			<SelectField
				id="rack-site"
				label="Site"
				required
				value={siteId()}
				onChange={handleSiteChange}
				options={row_options(sites() ?? [])}
				emptyLabel="Site…"
			/>
			<SelectField
				id="rack-location"
				label="Location"
				value={locationId()}
				disabled={siteId() === ''}
				onChange={setLocationId}
				options={row_options(locations() ?? [])}
				emptyLabel="No location"
				hint={
					<Show when={siteId() === ''}>
						<Hint>Pick a site first to choose a location.</Hint>
					</Show>
				}
			/>
			<NameField
				id="rack-name"
				placeholder="A1"
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus
			/>
			<SlugField
				id="rack-slug"
				placeholder="a1"
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
			/>
			<TextField
				id="rack-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<SelectField
				id="rack-type"
				label="Rack type"
				value=""
				options={[]}
				emptyLabel="No type"
				disabled
				describedBy={RACK_TYPE_HINT_ID}
				hint={
					<Hint id={RACK_TYPE_HINT_ID}>
						Pick the rack-type catalog entry for this rack.
					</Hint>
				}
			/>
			<SelectField
				id="rack-tenant"
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
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/racks" />
		</FormPage>
	)
}
