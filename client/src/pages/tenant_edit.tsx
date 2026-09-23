import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import { fetch_tenant, update_tenant } from '../api_tenancy'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /tenants/:id/edit — tenant edit form. Saves back to the detail page. */
export function TenantEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [loaded, setLoaded] = createSignal(false)

	const [tenant] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_tenant(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
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
		const res = await update_tenant(props.id, {
			name: trimmedName,
			slug: trimmedSlug,
			description: trimmedDescription === '' ? null : trimmedDescription,
			comments: trimmedComments === '' ? null : trimmedComments,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate(`/tenants/${props.id}`)
	}

	return (
		<div class="form-page">
			<p>
				<a
					href={`/tenants/${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/tenants/${props.id}`)}
				>
					← {tenant()?.name ?? 'Tenant'}
				</a>
			</p>
			<h2>Edit tenant</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading tenant…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="tenant-edit-name">
							Name{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="tenant-edit-name"
							placeholder="Acme Corp"
							required
							maxLength={100}
							value={name()}
							onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="tenant-edit-slug">
							Slug{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="tenant-edit-slug"
							placeholder="acme-corp"
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
						<label for="tenant-edit-description">Description</label>
						<input
							id="tenant-edit-description"
							placeholder="Short summary (optional)"
							maxLength={500}
							value={description()}
							onInput={(e: InputEventAndTarget) =>
								setDescription(e.currentTarget.value)
							}
						/>
					</div>
					<div class="field">
						<label for="tenant-edit-comments">Comments</label>
						<textarea
							id="tenant-edit-comments"
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
							onClick={() => navigate(`/tenants/${props.id}`)}
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
