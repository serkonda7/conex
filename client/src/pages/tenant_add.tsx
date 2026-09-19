import { Result } from 'better-result'
import { slugify } from 'shared/src/slug'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, onMount, Show } from 'solid-js'
import { create_tenant } from '../api_p1'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /tenants/add — NetBox-style tenant create form. */
export function TenantAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [slugTouched, setSlugTouched] = createSignal(false)
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	let nameInput: HTMLInputElement | undefined

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
		const res = await create_tenant({
			name: trimmedName,
			slug: trimmedSlug,
			description: description().trim() || undefined,
			comments: comments().trim() || undefined,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/tenants')
	}

	return (
		<div class="form-page">
			<p>
				<a href="/tenants" onClick={(e: MouseEvent): void => go(e, '/tenants')}>
					← Tenants
				</a>
			</p>
			<h2>Add a new tenant</h2>
			<form class="form-stacked" onSubmit={handleCreate}>
				<div class="field">
					<label for="tenant-name">
						Name{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="tenant-name"
						ref={nameInput}
						placeholder="Acme Corp"
						required
						maxLength={100}
						value={name()}
						onInput={(e: InputEventAndTarget) => handleNameInput(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="tenant-slug">
						Slug{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="tenant-slug"
						placeholder="acme-corp"
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
					<label for="tenant-description">Description</label>
					<input
						id="tenant-description"
						placeholder="Short summary (optional)"
						maxLength={500}
						value={description()}
						onInput={(e: InputEventAndTarget) => setDescription(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="tenant-comments">Comments</label>
					<textarea
						id="tenant-comments"
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
						{saving() ? 'Creating…' : 'Create'}
					</button>
					<button type="button" onClick={() => navigate('/tenants')} disabled={saving()}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	)
}
