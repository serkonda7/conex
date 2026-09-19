import { Result } from 'better-result'
import { slugify } from 'shared/src/slug'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, onMount, Show } from 'solid-js'
import {
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type SiteRow,
	type TenantRow,
} from '../api_p1'
import { create_rack } from '../api_p2'
import { navigate, parseId, queryParam } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /racks/add — NetBox-style rack create form. */
export function RackAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [slugTouched, setSlugTouched] = createSignal(false)
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [locationId, setLocationId] = createSignal(queryParam('location'))
	const [tenantId, setTenantId] = createSignal(queryParam('tenant'))
	const [description, setDescription] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	let nameInput: HTMLInputElement | undefined

	const [sites] = createResource(async () => {
		const res = await fetch_sites()
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

	// Location options belong to a site, so they follow the site picker.
	const [locations] = createResource(siteId, async (site: string) => {
		const id = parseId(site)
		if (id === null) {
			return []
		}
		const res = await fetch_locations({ site: id })
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	onMount(() => {
		nameInput?.focus()
	})

	function handleNameInput(value: string): void {
		setName(value)
		if (!slugTouched()) {
			setSlug(slugify(value))
		}
	}

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setLocationId('')
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setFormError(null)
		const trimmedName = name().trim()
		const trimmedSlug = slug().trim()
		if (!trimmedName) {
			setFormError('Name is required.')
			return
		}
		if (!trimmedSlug) {
			setFormError('Slug is required.')
			return
		}
		const site = parseId(siteId())
		if (site === null) {
			setFormError('Select a site first.')
			return
		}
		setSaving(true)
		const res = await create_rack({
			name: trimmedName,
			slug: trimmedSlug,
			site_id: site,
			location_id: locationId() ? Number(locationId()) : null,
			tenant_id: tenantId() ? Number(tenantId()) : null,
			description: description().trim() || undefined,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/racks')
	}

	return (
		<div class="form-page">
			<p>
				<a href="/racks" onClick={(e: MouseEvent): void => go(e, '/racks')}>
					← Racks
				</a>
			</p>
			<h2>Add a new rack</h2>
			<form class="form-stacked" onSubmit={handleCreate}>
				<div class="field">
					<label for="rack-site">
						Site{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<select
						id="rack-site"
						required
						value={siteId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							handleSiteChange(e.currentTarget.value)
						}
					>
						<option value="">Site…</option>
						<For each={sites() ?? []}>
							{(s: SiteRow): JSX.Element => <option value={s.id}>{s.name}</option>}
						</For>
					</select>
				</div>
				<div class="field">
					<label for="rack-location">Location</label>
					<select
						id="rack-location"
						value={locationId()}
						disabled={siteId() === ''}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setLocationId(e.currentTarget.value)
						}
					>
						<option value="">No location</option>
						<For each={locations() ?? []}>
							{(l: LocationRow): JSX.Element => (
								<option value={l.id}>{l.name}</option>
							)}
						</For>
					</select>
					<Show when={siteId() === ''}>
						<p class="field-hint">Pick a site first to choose a location.</p>
					</Show>
				</div>
				<div class="field">
					<label for="rack-name">
						Name{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="rack-name"
						ref={nameInput}
						placeholder="A1"
						required
						maxLength={100}
						value={name()}
						onInput={(e: InputEventAndTarget) => handleNameInput(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="rack-slug">
						Slug{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="rack-slug"
						placeholder="a1"
						required
						maxLength={100}
						pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
						value={slug()}
						onInput={(e: InputEventAndTarget) => {
							setSlugTouched(true)
							setSlug(e.currentTarget.value)
						}}
					/>
					<p class="field-hint">
						URL-safe identifier: lowercase letters, digits, single dashes. Auto-filled
						from the name.
					</p>
				</div>
				<div class="field">
					<label for="rack-description">Description</label>
					<input
						id="rack-description"
						placeholder="Short summary (optional)"
						maxLength={500}
						value={description()}
						onInput={(e: InputEventAndTarget) => setDescription(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="rack-type">Rack type</label>
					<select id="rack-type" disabled aria-describedby="rack-type-hint">
						<option value="">No type</option>
					</select>
					<p class="field-hint" id="rack-type-hint">
						Rack types are coming soon.
					</p>
				</div>
				<div class="field">
					<label for="rack-tenant">Tenant</label>
					<select
						id="rack-tenant"
						value={tenantId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setTenantId(e.currentTarget.value)
						}
					>
						<option value="">No tenant</option>
						<For each={tenants() ?? []}>
							{(t: TenantRow): JSX.Element => <option value={t.id}>{t.name}</option>}
						</For>
					</select>
				</div>
				<Show when={formError()}>
					<div class="app-inline-error" role="alert">
						{formError()}
					</div>
				</Show>
				<div class="form-actions">
					<button type="submit" disabled={saving()}>
						{saving() ? 'Creating…' : 'Create'}
					</button>
					<button type="button" onClick={() => navigate('/racks')} disabled={saving()}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	)
}
