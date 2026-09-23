import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	fetch_site,
	fetch_site_groups,
	fetch_tenants,
	type SiteGroupRow,
	type TenantRow,
	update_site,
} from '../api_tenancy'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /sites/:id/edit — site edit form. Saves back to the detail page. */
export function SiteEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [groupId, setGroupId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [physicalAddress, setPhysicalAddress] = createSignal('')
	const [shippingAddress, setShippingAddress] = createSignal('')
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

	const [groups] = createResource(async () => {
		const res = await fetch_site_groups()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [site] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_site(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setGroupId(res.value.site_group_id ? String(res.value.site_group_id) : '')
			setDescription(res.value.description ?? '')
			setComments(res.value.comments ?? '')
			setPhysicalAddress(res.value.physical_address ?? '')
			setShippingAddress(res.value.shipping_address ?? '')
			setLoaded(true)
			return res.value
		},
	)

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
		const trimmedComments = comments().trim()
		const trimmedPhysical = physicalAddress().trim()
		const trimmedShipping = shippingAddress().trim()
		const res = await update_site(props.id, {
			name: trimmedName,
			slug: trimmedSlug,
			tenant_id: tenantId() ? Number(tenantId()) : null,
			site_group_id: groupId() ? Number(groupId()) : null,
			description: trimmedDescription === '' ? null : trimmedDescription,
			comments: trimmedComments === '' ? null : trimmedComments,
			physical_address: trimmedPhysical === '' ? null : trimmedPhysical,
			shipping_address: trimmedShipping === '' ? null : trimmedShipping,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate(`/sites/${props.id}`)
	}

	return (
		<div class="form-page">
			<p>
				<a
					href={`/sites/${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/sites/${props.id}`)}
				>
					← {site()?.name ?? 'Site'}
				</a>
			</p>
			<h2>Edit site</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading site…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="site-edit-name">
							Name{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="site-edit-name"
							placeholder="New York DC"
							required
							maxLength={100}
							value={name()}
							onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="site-edit-slug">
							Slug{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="site-edit-slug"
							placeholder="new-york-dc"
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
						<label for="site-edit-tenant">Tenant</label>
						<select
							id="site-edit-tenant"
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
						<label for="site-edit-group">Group</label>
						<select
							id="site-edit-group"
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
						<label for="site-edit-description">Description</label>
						<input
							id="site-edit-description"
							placeholder="Short summary (optional)"
							maxLength={500}
							value={description()}
							onInput={(e: InputEventAndTarget) =>
								setDescription(e.currentTarget.value)
							}
						/>
					</div>
					<div class="field">
						<label for="site-edit-comments">Comments</label>
						<textarea
							id="site-edit-comments"
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
						<label for="site-edit-physical-address">Physical address</label>
						<textarea
							id="site-edit-physical-address"
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
						<label for="site-edit-shipping-address">Shipping address</label>
						<textarea
							id="site-edit-shipping-address"
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
							{saving() ? 'Saving…' : 'Save'}
						</button>
						<button
							type="button"
							onClick={() => navigate(`/sites/${props.id}`)}
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
