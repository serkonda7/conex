import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	fetch_site_group,
	fetch_site_groups,
	fetch_tenants,
	type SiteGroupRow,
	type TenantRow,
	update_site_group,
} from '../api_tenancy'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /site-groups/:id/edit — site group edit form. Saves back to the detail page. */
export function SiteGroupEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [parentId, setParentId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [loaded, setLoaded] = createSignal(false)

	const [groups] = createResource(async () => {
		const res = await fetch_site_groups()
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

	const [group] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_site_group(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setParentId(res.value.parent_id ? String(res.value.parent_id) : '')
			setDescription(res.value.description ?? '')
			setComments(res.value.comments ?? '')
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
		const res = await update_site_group(props.id, {
			name: trimmedName,
			slug: trimmedSlug,
			tenant_id: tenantId() ? Number(tenantId()) : null,
			parent_id: parentId() ? Number(parentId()) : null,
			description: trimmedDescription === '' ? null : trimmedDescription,
			comments: trimmedComments === '' ? null : trimmedComments,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate(`/site-groups/${props.id}`)
	}

	return (
		<div class="form-page">
			<p>
				<a
					href={`/site-groups/${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/site-groups/${props.id}`)}
				>
					← {group()?.name ?? 'Site group'}
				</a>
			</p>
			<h2>Edit site group</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading site group…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="site-group-edit-name">
							Name{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="site-group-edit-name"
							placeholder="US East"
							required
							maxLength={100}
							value={name()}
							onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="site-group-edit-slug">
							Slug{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="site-group-edit-slug"
							placeholder="us-east"
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
						<label for="site-group-edit-tenant">Tenant</label>
						<select
							id="site-group-edit-tenant"
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
						<label for="site-group-edit-parent">Parent</label>
						<select
							id="site-group-edit-parent"
							value={parentId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setParentId(e.currentTarget.value)
							}
						>
							<option value="">Top level</option>
							<For
								each={(groups() ?? []).filter(
									(g: SiteGroupRow) => g.id !== props.id,
								)}
							>
								{(g: SiteGroupRow): JSX.Element => (
									<option value={g.id}>{g.name}</option>
								)}
							</For>
						</select>
					</div>
					<div class="field">
						<label for="site-group-edit-description">Description</label>
						<input
							id="site-group-edit-description"
							placeholder="Short summary (optional)"
							maxLength={500}
							value={description()}
							onInput={(e: InputEventAndTarget) =>
								setDescription(e.currentTarget.value)
							}
						/>
					</div>
					<div class="field">
						<label for="site-group-edit-comments">Comments</label>
						<textarea
							id="site-group-edit-comments"
							placeholder="Additional notes (optional)"
							rows={4}
							maxLength={2000}
							value={comments()}
							onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) =>
								setComments(e.currentTarget.value)
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
							onClick={() => navigate(`/site-groups/${props.id}`)}
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
