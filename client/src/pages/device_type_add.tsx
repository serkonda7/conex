import { IconPlus } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { create_device_type, fetch_manufacturers } from '../api_templates'
import {
	FormActions,
	FormError,
	FormPage,
	row_options,
	SelectField,
	TextAreaField,
	TextField,
} from '../components/form'
import { navigate } from '../router'
import { is_add_another_submit } from '../util/form'

/** /device-types/add — device-type create form. */
export function DeviceTypeAddPage(): JSX.Element {
	const [manufacturerId, setManufacturerId] = createSignal('')
	const [model, setModel] = createSignal('')
	const [uHeight, setUHeight] = createSignal('1')
	const [fullDepth, setFullDepth] = createSignal(false)
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [manufacturers] = createResource(async () => {
		const res = await fetch_manufacturers({})
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const manufacturer = Number(manufacturerId())
		const height = Number(uHeight())
		if (!Number.isInteger(manufacturer) || manufacturer < 1) {
			setError('Select a manufacturer.')
			return
		}
		if (!model().trim()) {
			setError('Model is required.')
			return
		}
		if (!Number.isInteger(height) || height < 0 || height > 60) {
			setError('U height must be an integer from 0 to 60.')
			return
		}
		setSaving(true)
		const res = await create_device_type({
			manufacturer_id: manufacturer,
			model: model().trim(),
			u_height: height,
			is_full_depth: fullDepth(),
			description: description().trim() || undefined,
			comments: comments().trim() || undefined,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		if (is_add_another_submit(e)) {
			setModel('')
			setUHeight('1')
			setFullDepth(false)
			setDescription('')
			setComments('')
			return
		}
		navigate('/device-types')
	}

	return (
		<FormPage
			backTo="/device-types"
			backLabel="Device types"
			title="Add a device type"
			onSubmit={handleCreate}
		>
			<SelectField
				id="device-type-manufacturer"
				label="Manufacturer"
				required
				autofocus
				value={manufacturerId()}
				onChange={setManufacturerId}
				options={row_options(manufacturers() ?? [])}
				emptyLabel="Manufacturer…"
				action={
					<button
						type="button"
						class="icon-btn btn-add"
						aria-label="Add manufacturer"
						title="Add manufacturer"
						onClick={() => navigate('/manufacturers/add')}
					>
						<IconPlus size={16} />
					</button>
				}
			/>
			<TextField
				id="device-type-model"
				label="Model"
				required
				value={model()}
				onInput={setModel}
				placeholder="Example Switch 48"
			/>
			<TextField
				id="device-type-u-height"
				label="Height (U)"
				type="number"
				required
				min={0}
				step={0.5}
				value={uHeight()}
				onInput={setUHeight}
				placeholder="1"
			/>
			<div class="field">
				<div class="field-control">
					<label class="field-checkbox-label">
						<input
							id="device-type-full-depth"
							type="checkbox"
							checked={fullDepth()}
							onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
								setFullDepth(e.currentTarget.checked)
							}
						/>
						Full depth
					</label>
				</div>
			</div>
			<TextField
				id="device-type-description"
				label="Description"
				value={description()}
				onInput={setDescription}
				placeholder="Short summary (optional)"
				maxLength={500}
			/>
			<TextAreaField
				id="device-type-comments"
				label="Comments"
				value={comments()}
				onInput={setComments}
				maxLength={2000}
			/>
			<FormError message={error} />
			<FormActions saving={saving()} cancelTo="/device-types" />
		</FormPage>
	)
}
