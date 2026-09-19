import { Result } from 'better-result'
import { slugify } from 'shared/src/slug'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, onMount, Show } from 'solid-js'
import {
	create_site,
	fetch_site_groups,
	fetch_tenants,
	type SiteGroupRow,
	type TenantRow,
} from '../api_p1'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /sites/add — NetBox-style site create form. */
export function SiteAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [slugTouched, setSlugTouched] = createSignal(false)
	const [tenantId, setTenantId] = createSignal('')
	const [groupId, setGroupId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [physicalAddress, setPhysicalAddress] = createSignal('')
	const [shippingAddress, setShippingAddress] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	let nameInput: HTMLInputElement | undefined

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [groups] = createResource(async () => {
		const res = await fetch_site_groups()
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
		setSaving(true)
		const res = await create_site({
			name: trimmedName,
			slug: trimmedSlug,
			tenant_id: tenantId() ? Number(tenantId()) : null,
			site_group_id: groupId() ? Number(groupId()) : null,
			description: description().trim() || undefined,
			comments: comments().trim() || undefined,
			physical_address: physicalAddress().trim() || undefined,
			shipping_address: shippingAddress().trim() || undefined,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/sites')
	}

	return (
		<div class="form-page">
			<p>
				<a href="/sites" onClick={(e: MouseEvent): void => go(e, '/sites')}>
					← Sites
				</a>
			</p>
			<h2>Add a new site</h2>
			<form class="form-stacked" onSubmit={handleCreate}>
				<div class="field">
					<label for="site-name">
						Name{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="site-name"
						ref={nameInput}
						placeholder="New York DC"
						required
						maxLength={100}
						value={name()}
						onInput={(e: InputEventAndTarget) => handleNameInput(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="site-slug">
						Slug{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="site-slug"
						placeholder="new-york-dc"
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
					<label for="site-tenant">Tenant</label>
					<select
						id="site-tenant"
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
					<label for="site-group">Group</label>
					<select
						id="site-group"
						value={groupId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setGroupId(e.currentTarget.value)
						}
					>
						<option value="">No group</option>
						<For each={groups() ?? []}>
							{(g: SiteGroupRow): JSX.Element => (
								<option value={g.id}>{g.name}</option>
							)}
						</For>
					</select>
				</div>
				<div class="field">
					<label for="site-description">Description</label>
					<input
						id="site-description"
						placeholder="Short summary (optional)"
						maxLength={500}
						value={description()}
						onInput={(e: InputEventAndTarget) => setDescription(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="site-comments">Comments</label>
					<textarea
						id="site-comments"
						placeholder="Additional notes (optional)"
						rows={4}
						maxLength={2000}
						value={comments()}
						onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) =>
							setComments(e.currentTarget.value)
						}
					/>
				</div>
				<div class="field">
					<label for="site-physical-address">Physical address</label>
					<textarea
						id="site-physical-address"
						placeholder="Street, city, … (optional)"
						rows={3}
						maxLength={500}
						value={physicalAddress()}
						onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) =>
							setPhysicalAddress(e.currentTarget.value)
						}
					/>
				</div>
				<div class="field">
					<label for="site-shipping-address">Shipping address</label>
					<textarea
						id="site-shipping-address"
						placeholder="Receiving dock, … (optional)"
						rows={3}
						maxLength={500}
						value={shippingAddress()}
						onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) =>
							setShippingAddress(e.currentTarget.value)
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
						{saving() ? 'Creating…' : 'Create'}
					</button>
					<button type="button" onClick={() => navigate('/sites')} disabled={saving()}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	)
}
