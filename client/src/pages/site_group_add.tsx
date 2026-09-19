import { Result } from 'better-result'
import { slugify } from 'shared/src/slug'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, onMount, Show } from 'solid-js'
import { create_site_group, fetch_site_groups, type SiteGroupRow } from '../api_p1'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /site-groups/add — NetBox-style site group create form. */
export function SiteGroupAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [slugTouched, setSlugTouched] = createSignal(false)
	const [parentId, setParentId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	let nameInput: HTMLInputElement | undefined

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
		const res = await create_site_group({
			name: trimmedName,
			slug: trimmedSlug,
			parent_id: parentId() ? Number(parentId()) : null,
			description: description().trim() || undefined,
			comments: comments().trim() || undefined,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/site-groups')
	}

	return (
		<div class="form-page">
			<p>
				<a href="/site-groups" onClick={(e: MouseEvent): void => go(e, '/site-groups')}>
					← Site Groups
				</a>
			</p>
			<h2>Add a new site group</h2>
			<form class="form-stacked" onSubmit={handleCreate}>
				<div class="field">
					<label for="site-group-name">
						Name{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="site-group-name"
						ref={nameInput}
						placeholder="US East"
						required
						maxLength={100}
						value={name()}
						onInput={(e: InputEventAndTarget) => handleNameInput(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="site-group-slug">
						Slug{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="site-group-slug"
						placeholder="us-east"
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
					<label for="site-group-parent">Parent</label>
					<select
						id="site-group-parent"
						value={parentId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setParentId(e.currentTarget.value)
						}
					>
						<option value="">Top level</option>
						<For each={groups() ?? []}>
							{(g: SiteGroupRow): JSX.Element => (
								<option value={g.id}>{g.name}</option>
							)}
						</For>
					</select>
				</div>
				<div class="field">
					<label for="site-group-description">Description</label>
					<input
						id="site-group-description"
						placeholder="Short summary (optional)"
						maxLength={500}
						value={description()}
						onInput={(e: InputEventAndTarget) => setDescription(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="site-group-comments">Comments</label>
					<textarea
						id="site-group-comments"
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
					<button
						type="button"
						onClick={() => navigate('/site-groups')}
						disabled={saving()}
					>
						Cancel
					</button>
				</div>
			</form>
		</div>
	)
}
