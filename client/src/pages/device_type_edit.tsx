import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	fetch_device_type,
	fetch_manufacturers,
	type ManufacturerRow,
	update_device_type,
} from '../api_p3'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /device-types/:id/edit — device-type edit form. Saves back to the detail page. */
export function DeviceTypeEditPage(props: { id: number }): JSX.Element {
	const [manufacturerId, setManufacturerId] = createSignal('')
	const [model, setModel] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [uHeight, setUHeight] = createSignal('1')
	const [fullDepth, setFullDepth] = createSignal(true)
	const [description, setDescription] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [loaded, setLoaded] = createSignal(false)

	const [manufacturers] = createResource(async () => {
		const res = await fetch_manufacturers({})
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [deviceType] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_device_type(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setManufacturerId(String(res.value.manufacturer_id))
			setModel(res.value.model)
			setSlug(res.value.slug)
			setUHeight(String(res.value.u_height))
			setFullDepth(Boolean(res.value.is_full_depth))
			setDescription(res.value.description ?? '')
			setLoaded(true)
			return res.value
		},
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setFormError(null)
		const manufacturer = Number(manufacturerId())
		if (!Number.isInteger(manufacturer) || manufacturer < 1) {
			setFormError('Select a manufacturer.')
			return
		}
		const trimmedModel = model().trim()
		const trimmedSlug = slug().trim()
		if (!trimmedModel) {
			setFormError('Model is required.')
			return
		}
		if (!trimmedSlug) {
			setFormError('Slug is required.')
			return
		}
		const height = Number(uHeight())
		if (!Number.isInteger(height) || height < 0 || height > 60) {
			setFormError('U height must be an integer from 0 to 60 (0 = virtual).')
			return
		}
		setSaving(true)
		const trimmedDescription = description().trim()
		const res = await update_device_type(props.id, {
			manufacturer_id: manufacturer,
			model: trimmedModel,
			slug: trimmedSlug,
			u_height: height,
			is_full_depth: fullDepth(),
			description: trimmedDescription === '' ? null : trimmedDescription,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate(`/device-types/${props.id}`)
	}

	return (
		<div class="form-page">
			<p>
				<a
					href={`/device-types/${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/device-types/${props.id}`)}
				>
					← {deviceType()?.model ?? 'Device type'}
				</a>
			</p>
			<h2>Edit device type</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading device type…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="device-type-edit-manufacturer">
							Manufacturer{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<select
							id="device-type-edit-manufacturer"
							required
							value={manufacturerId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setManufacturerId(e.currentTarget.value)
							}
						>
							<option value="">Manufacturer…</option>
							<For each={manufacturers() ?? []}>
								{(m: ManufacturerRow) => <option value={m.id}>{m.name}</option>}
							</For>
						</select>
					</div>
					<div class="field">
						<label for="device-type-edit-model">
							Model{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="device-type-edit-model"
							placeholder="Example Switch 48"
							required
							maxLength={100}
							value={model()}
							onInput={(e: InputEventAndTarget) => setModel(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="device-type-edit-slug">
							Slug{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="device-type-edit-slug"
							placeholder="example-switch-48"
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
						<label for="device-type-edit-u-height">
							Height{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="device-type-edit-u-height"
							placeholder="1"
							required
							inputmode="numeric"
							value={uHeight()}
							onInput={(e: InputEventAndTarget) => setUHeight(e.currentTarget.value)}
						/>
						<p class="field-hint">0 = virtual or shelf-only, otherwise 1–60.</p>
					</div>
					<div class="field">
						<label for="device-type-edit-full-depth">Full depth</label>
						<input
							id="device-type-edit-full-depth"
							type="checkbox"
							checked={fullDepth()}
							onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
								setFullDepth(e.currentTarget.checked)
							}
						/>
						<p class="field-hint">Off for half-depth or shelf-only devices.</p>
					</div>
					<div class="field">
						<label for="device-type-edit-description">Description</label>
						<input
							id="device-type-edit-description"
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
							onClick={() => navigate(`/device-types/${props.id}`)}
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
