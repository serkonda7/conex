import { Result } from 'better-result'
import { slugify } from 'shared/src/slug'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js'
import {
	create_location,
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type SiteRow,
	type TenantRow,
} from '../api_p1'
import { navigate, parseId, queryParam } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /locations/add — NetBox-style location create form. */
export function LocationAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [slugTouched, setSlugTouched] = createSignal(false)
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [parentId, setParentId] = createSignal('')
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

	// Parent options belong to a site, so they follow the site picker.
	const [parents] = createResource(siteId, async (site: string) => {
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

	const parentOptions = createMemo(() => parents() ?? [])

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
		setParentId('')
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
		const res = await create_location({
			name: trimmedName,
			slug: trimmedSlug,
			site_id: site,
			parent_id: parentId() ? Number(parentId()) : null,
			tenant_id: tenantId() ? Number(tenantId()) : null,
			description: description().trim() || undefined,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/locations')
	}

	return (
		<div class="form-page">
			<p>
				<a href="/locations" onClick={(e: MouseEvent): void => go(e, '/locations')}>
					← Locations
				</a>
			</p>
			<h2>Add a new location</h2>
			<form class="form-stacked" onSubmit={handleCreate}>
				<div class="field">
					<label for="location-name">
						Name{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="location-name"
						ref={nameInput}
						placeholder="Floor 2"
						required
						maxLength={100}
						value={name()}
						onInput={(e: InputEventAndTarget) => handleNameInput(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="location-slug">
						Slug{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="location-slug"
						placeholder="floor-2"
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
					<label for="location-site">
						Site{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<select
						id="location-site"
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
					<label for="location-parent">Parent</label>
					<select
						id="location-parent"
						value={parentId()}
						disabled={siteId() === ''}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setParentId(e.currentTarget.value)
						}
					>
						<option value="">Top level</option>
						<For each={parentOptions()}>
							{(l: LocationRow): JSX.Element => (
								<option value={l.id}>{l.name}</option>
							)}
						</For>
					</select>
					<Show when={siteId() === ''}>
						<p class="field-hint">Pick a site first to choose a parent.</p>
					</Show>
				</div>
				<div class="field">
					<label for="location-tenant">Tenant</label>
					<select
						id="location-tenant"
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
				<div class="field">
					<label for="location-description">Description</label>
					<input
						id="location-description"
						placeholder="Short summary (optional)"
						maxLength={500}
						value={description()}
						onInput={(e: InputEventAndTarget) => setDescription(e.currentTarget.value)}
					/>
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
					<button
						type="button"
						onClick={() => navigate('/locations')}
						disabled={saving()}
					>
						Cancel
					</button>
				</div>
			</form>
		</div>
	)
}
