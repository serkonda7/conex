import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	fetch_location,
	fetch_locations,
	fetch_site,
	fetch_tenants,
	type LocationRow,
	type TenantRow,
} from '../api_p1'
import { fetch_rack, update_rack } from '../api_p2'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /racks/:id/edit — rack edit form. Saves back to the detail page. */
export function RackEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [locationId, setLocationId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [siteId, setSiteId] = createSignal<number | null>(null)
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [loaded, setLoaded] = createSignal(false)

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [rack] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_rack(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
			setLocationId(res.value.location_id ? String(res.value.location_id) : '')
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setDescription(res.value.description ?? '')
			setSiteId(res.value.site_id)
			setLoaded(true)
			return res.value
		},
	)

	// Location options stay within the same site; site itself is immutable.
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

	const [currentLocation] = createResource(locationId, async (raw: string) => {
		if (!raw) {
			return null
		}
		const res = await fetch_location(Number(raw))
		if (Result.isError(res)) {
			return null
		}
		return res.value
	})

	async function handleSave(e: SubmitEvent): Promise<void> {
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
		setSaving(true)
		const trimmedDescription = description().trim()
		const res = await update_rack(props.id, {
			name: trimmedName,
			slug: trimmedSlug,
			location_id: locationId() ? Number(locationId()) : null,
			tenant_id: tenantId() ? Number(tenantId()) : null,
			description: trimmedDescription === '' ? null : trimmedDescription,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate(`/racks/${props.id}`)
	}

	return (
		<div class="form-page">
			<p>
				<a
					href={`/racks/${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/racks/${props.id}`)}
				>
					← {rack()?.name ?? 'Rack'}
				</a>
			</p>
			<h2>Edit rack</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading rack…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="rack-edit-site">Site</label>
						<input
							id="rack-edit-site"
							value={site()?.name ?? (siteId() ? String(siteId()) : '')}
							disabled
							aria-describedby="rack-edit-site-hint"
						/>
						<p class="field-hint" id="rack-edit-site-hint">
							Site cannot be changed after creation.
						</p>
					</div>
					<div class="field">
						<label for="rack-edit-location">Location</label>
						<select
							id="rack-edit-location"
							value={locationId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setLocationId(e.currentTarget.value)
							}
						>
							<option value="">No location</option>
							<For each={siblings() ?? []}>
								{(l: LocationRow): JSX.Element => (
									<option value={l.id}>{l.name}</option>
								)}
							</For>
							<Show
								when={
									locationId() !== '' &&
									(siblings() ?? []).every(
										(l: LocationRow) => String(l.id) !== locationId(),
									) &&
									currentLocation()
								}
							>
								<option value={currentLocation()?.id ?? locationId()}>
									{currentLocation()?.name ?? locationId()}
								</option>
							</Show>
						</select>
					</div>
					<div class="field">
						<label for="rack-edit-name">
							Name{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="rack-edit-name"
							placeholder="A1"
							required
							maxLength={100}
							value={name()}
							onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="rack-edit-slug">
							Slug{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="rack-edit-slug"
							placeholder="a1"
							required
							maxLength={100}
							pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
							value={slug()}
							onInput={(e: InputEventAndTarget) => setSlug(e.currentTarget.value)}
						/>
						<p class="field-hint">
							URL-safe identifier: lowercase letters, digits, single dashes.
						</p>
					</div>
					<div class="field">
						<label for="rack-edit-description">Description</label>
						<input
							id="rack-edit-description"
							placeholder="Short summary (optional)"
							maxLength={500}
							value={description()}
							onInput={(e: InputEventAndTarget) =>
								setDescription(e.currentTarget.value)
							}
						/>
					</div>
					<div class="field">
						<label for="rack-edit-type">Rack type</label>
						<select id="rack-edit-type" disabled aria-describedby="rack-edit-type-hint">
							<option value="">No type</option>
						</select>
						<p class="field-hint" id="rack-edit-type-hint">
							Rack types are coming soon.
						</p>
					</div>
					<div class="field">
						<label for="rack-edit-tenant">Tenant</label>
						<select
							id="rack-edit-tenant"
							value={tenantId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setTenantId(e.currentTarget.value)
							}
						>
							<option value="">No tenant</option>
							<For each={tenants() ?? []}>
								{(t: TenantRow): JSX.Element => (
									<option value={t.id}>{t.name}</option>
								)}
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
							{saving() ? 'Saving…' : 'Save'}
						</button>
						<button
							type="button"
							onClick={() => navigate(`/racks/${props.id}`)}
							disabled={saving()}
						>
							Cancel
						</button>
					</div>
				</form>
			</Show>
		</div>
	)
}
