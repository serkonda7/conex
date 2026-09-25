import { Result } from 'better-result'
import { createResource, createSignal, type JSX } from 'solid-js'
import { fetch_device_type, fetch_manufacturers, update_device_type } from '../api_templates'
import {
	EditActions,
	EditPageShell,
	FormError,
	row_options,
	SelectField,
	TextAreaField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /device-types/:id/edit — device-type edit form. Saves back to the detail page. */
export function DeviceTypeEditPage(props: { id: number }): JSX.Element {
	const [manufacturerId, setManufacturerId] = createSignal('')
	const [model, setModel] = createSignal('')
	const [uHeight, setUHeight] = createSignal('1')
	const [fullDepth, setFullDepth] = createSignal(true)
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

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
			setUHeight(String(res.value.u_height))
			setFullDepth(Boolean(res.value.is_full_depth))
			setDescription(res.value.description ?? '')
			setComments(res.value.comments ?? '')
			setLoaded(true)
			return res.value
		},
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: model(),
			nameError: t('deviceType.modelRequired'),
			validate: () => {
				const manufacturer = Number(manufacturerId())
				if (!Number.isInteger(manufacturer) || manufacturer < 1) {
					return t('deviceType.selectManufacturer')
				}
				const height = Number(uHeight())
				if (!Number.isInteger(height) || height < 0 || height > 60) {
					return t('deviceType.heightRange', { min: 0, max: 60 })
				}
				return null
			},
			save: (values: FormValues) =>
				update_device_type(props.id, {
					manufacturer_id: Number(manufacturerId()),
					model: values.name,
					u_height: Number(uHeight()),
					is_full_depth: fullDepth(),
					description: description().trim() === '' ? null : description().trim(),
					comments: comments().trim() === '' ? null : comments().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/device-types/${props.id}`,
		})
	}

	return (
		<EditPageShell
			name={deviceType()?.model}
			title={t('deviceType.editTitle')}
			loaded={loaded()}
			loadingText={t('deviceType.loadingOne')}
			onSubmit={handleSave}
		>
			<SelectField
				id="device-type-edit-manufacturer"
				label={tp('entity.manufacturer', 1)}
				value={manufacturerId()}
				onChange={setManufacturerId}
				options={row_options(manufacturers() ?? [])}
				emptyLabel={t('deviceType.manufacturerPlaceholder')}
				required
			/>
			<TextField
				id="device-type-edit-model"
				label={t('common.model')}
				placeholder={t('deviceType.modelPlaceholder')}
				maxLength={100}
				required
				value={model()}
				onInput={setModel}
			/>
			<TextField
				id="device-type-edit-u-height"
				label={t('common.heightU')}
				type="number"
				placeholder="1"
				required
				min={0}
				max={60}
				step={1}
				inputmode="numeric"
				value={uHeight()}
				onInput={setUHeight}
			/>
			<div class="field">
				<div class="field-control">
					<label class="field-checkbox-label">
						<input
							id="device-type-edit-full-depth"
							type="checkbox"
							checked={fullDepth()}
							onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
								setFullDepth(e.currentTarget.checked)
							}
						/>
						{t('common.fullDepth')}
					</label>
				</div>
			</div>
			<TextField
				id="device-type-edit-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="device-type-edit-comments"
				label={t('common.comments')}
				rows={4}
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/device-types/${props.id}`} />
		</EditPageShell>
	)
}
