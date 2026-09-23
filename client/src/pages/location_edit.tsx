import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import {
	fetch_location,
	fetch_locations,
	fetch_site,
	fetch_tenants,
	update_location,
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
	TextField,
} from '../components/form'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /locations/:id/edit — location edit form. Saves back to the detail page. */
export function LocationEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [parentId, setParentId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [siteId, setSiteId] = createSignal<number | null>(null)
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [location] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_location(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
			setParentId(res.value.parent_id ? String(res.value.parent_id) : '')
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setDescription(res.value.description ?? '')
			setSiteId(res.value.site_id)
			setLoaded(true)
			return res.value
		},
	)

	// Parent options stay within the same site; site itself is immutable.
	const [siblings] = createResource(siteId, async (siteKey: number | null) => {
		if (!siteKey) {
			return []
		}
		const res = await fetch_locations({ site: siteKey })
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [site] = createResource(siteId, async (siteKey: number | null) => {
		if (!siteKey) {
			return null
		}
		const res = await fetch_site(siteKey)
		if (Result.isError(res)) {
			return null
		}
		return res.value
	})

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: name(),
			slug: slug(),
			save: (values: FormValues) =>
				update_location(props.id, {
					name: values.name,
					slug: values.slug,
					parent_id: parentId() ? Number(parentId()) : null,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					description: description().trim() === '' ? null : description().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/locations/${props.id}`,
		})
	}

	return (
		<EditPageShell
			backTo={`/locations/${props.id}`}
			backLabel={location()?.name ?? 'Location'}
			title="Bereich bearbeiten"
			loaded={loaded()}
			loadingText="Bereich wird geladen…"
			onSubmit={handleSave}
		>
			<div class="field">
				<label for="location-edit-site">Standort</label>
				<input
					id="location-edit-site"
					value={site()?.name ?? (siteId() ? String(siteId()) : '')}
					disabled
					aria-describedby="location-edit-site-hint"
				/>
				<p class="field-hint" id="location-edit-site-hint">
					Site cannot be changed after creation.
				</p>
			</div>
			<NameField
				id="location-edit-name"
				placeholder="Floor 2"
				value={name()}
				onInput={setName}
			/>
			<SlugField
				id="location-edit-slug"
				placeholder="floor-2"
				value={slug()}
				onInput={setSlug}
				hint={<Hint>URL-safe identifier: lowercase letters, digits, single dashes.</Hint>}
			/>
			<SelectField
				id="location-edit-parent"
				label="Parent"
				value={parentId()}
				onChange={setParentId}
				options={row_options((siblings() ?? []).filter((l) => l.id !== props.id))}
				emptyLabel="Top level"
			/>
			<SelectField
				id="location-edit-tenant"
				label="Mandant"
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel="Kein Mandant"
			/>
			<TextField
				id="location-edit-description"
				label="Beschreibung"
				placeholder="Kurze Zusammenfassung (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/locations/${props.id}`} />
		</EditPageShell>
	)
}
