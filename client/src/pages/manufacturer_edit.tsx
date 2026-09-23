import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import { fetch_manufacturer, update_manufacturer } from '../api_templates'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /manufacturers/:id/edit — manufacturer edit form. Saves back to the detail page. */
export function ManufacturerEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [loaded, setLoaded] = createSignal(false)

	const [manufacturer] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_manufacturer(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setDescription(res.value.description ?? '')
			setLoaded(true)
			return res.value
		},
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setFormError(null)
		const trimmedName = name().trim()
		if (!trimmedName) {
			setFormError('Name is required.')
			return
		}
		setSaving(true)
		const trimmedDescription = description().trim()
		const res = await update_manufacturer(props.id, {
			name: trimmedName,
			description: trimmedDescription === '' ? null : trimmedDescription,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate(`/manufacturers/${props.id}`)
	}

	return (
		<div class="form-page">
			<p>
				<a
					href={`/manufacturers/${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/manufacturers/${props.id}`)}
				>
					← {manufacturer()?.name ?? 'Manufacturer'}
				</a>
			</p>
			<h2>Edit manufacturer</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading manufacturer…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="manufacturer-edit-name">
							Name{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="manufacturer-edit-name"
							placeholder="Acme"
							required
							maxLength={100}
							value={name()}
							onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="manufacturer-edit-description">Description</label>
						<input
							id="manufacturer-edit-description"
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
							onClick={() => navigate(`/manufacturers/${props.id}`)}
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
