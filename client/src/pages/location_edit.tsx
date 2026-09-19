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
	update_location,
} from '../api_p1'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /locations/:id/edit — location edit form. Saves back to the detail page. */
export function LocationEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [parentId, setParentId] = createSignal('')
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
		const res = await update_location(props.id, {
			name: trimmedName,
			slug: trimmedSlug,
			parent_id: parentId() ? Number(parentId()) : null,
			tenant_id: tenantId() ? Number(tenantId()) : null,
			description: trimmedDescription === '' ? null : trimmedDescription,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate(`/locations/${props.id}`)
	}

	return (
		<div class="form-page">
			<p>
				<a
					href={`/locations/${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/locations/${props.id}`)}
				>
					← {location()?.name ?? 'Location'}
				</a>
			</p>
			<h2>Edit location</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading location…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="location-edit-site">Site</label>
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
					<div class="field">
						<label for="location-edit-name">
							Name{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="location-edit-name"
							placeholder="Floor 2"
							required
							maxLength={100}
							value={name()}
							onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="location-edit-slug">
							Slug{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="location-edit-slug"
							placeholder="floor-2"
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
						<label for="location-edit-parent">Parent</label>
						<select
							id="location-edit-parent"
							value={parentId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setParentId(e.currentTarget.value)
							}
						>
							<option value="">Top level</option>
							<For
								each={(siblings() ?? []).filter(
									(l: LocationRow) => l.id !== props.id,
								)}
							>
								{(l: LocationRow): JSX.Element => (
									<option value={l.id}>{l.name}</option>
								)}
							</For>
						</select>
					</div>
					<div class="field">
						<label for="location-edit-tenant">Tenant</label>
						<select
							id="location-edit-tenant"
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
					<div class="field">
						<label for="location-edit-description">Description</label>
						<input
							id="location-edit-description"
							placeholder="Short summary (optional)"
							maxLength={500}
							value={description()}
							onInput={(e: InputEventAndTarget) =>
								setDescription(e.currentTarget.value)
							}
						/>
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
							onClick={() => navigate(`/locations/${props.id}`)}
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
