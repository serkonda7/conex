import { IconPlus } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { create_device_type, fetch_manufacturers, type RackFormFactor } from '../api_templates'
import {
	Field,
	FormActions,
	FormError,
	FormPage,
	row_options,
	SelectField,
	TextAreaField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { formFactorLabel } from '../i18n/labels'
import { navigate } from '../router'
import { is_add_another_submit } from '../util/form'

const FORM_FACTORS: RackFormFactor[] = [
	'2-post frame',
	'4-post frame',
	'4-post cabinet',
	'wall-mounted frame',
	'wall-mounted cabinet',
]

/** /rack-types/add — create a NetBox-compatible rack type. */
export function RackTypeAddPage(): JSX.Element {
	const [manufacturerId, setManufacturerId] = createSignal('')
	const [model, setModel] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [formFactor, setFormFactor] = createSignal<RackFormFactor | ''>('')
	const [height, setHeight] = createSignal('1')
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
		const rackHeight = Number(height())
		if (!Number.isInteger(manufacturer) || manufacturer < 1) {
			setError(t('deviceType.selectManufacturer'))
			return
		}
		if (!formFactor()) {
			setError(t('rackType.selectFormFactor'))
			return
		}
		if (!Number.isInteger(rackHeight) || rackHeight < 1 || rackHeight > 60) {
			setError(t('rackType.heightRange'))
			return
		}
		setSaving(true)
		const res = await create_device_type({
			manufacturer_id: manufacturer,
			model: model().trim(),
			description: description().trim() || undefined,
			form_factor: formFactor() || undefined,
			width: 19,
			u_height: rackHeight,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		if (is_add_another_submit(e)) {
			setModel('')
			setDescription('')
			setFormFactor('')
			setHeight('1')
			return
		}
		navigate('/rack-types')
	}

	return (
		<FormPage title={t('rackType.addTitle')} onSubmit={handleCreate}>
			<SelectField
				id="rack-type-manufacturer"
				label={tp('entity.manufacturer', 1)}
				required
				value={manufacturerId()}
				onChange={setManufacturerId}
				options={row_options(manufacturers() ?? [])}
				emptyLabel={t('deviceType.manufacturerPlaceholder')}
				action={
					<button
						type="button"
						class="icon-btn btn-add"
						aria-label={t('app.navAdd', { label: tp('entity.manufacturer', 1) })}
						title={t('app.navAdd', { label: tp('entity.manufacturer', 1) })}
						onClick={() => navigate('/manufacturers/add')}
					>
						<IconPlus size={16} />
					</button>
				}
			/>
			<TextField
				id="rack-type-model"
				label={t('common.model')}
				required
				value={model()}
				onInput={setModel}
				placeholder={t('rackType.modelPlaceholder')}
				autofocus
			/>
			<SelectField
				id="rack-type-form-factor"
				label={t('rackType.formFactor')}
				required
				value={formFactor()}
				onChange={setFormFactor}
				options={FORM_FACTORS.map((value) => ({ value, label: formFactorLabel(value) }))}
				emptyLabel={t('rackType.formFactorPlaceholder')}
			/>
			<Field label={t('rackType.widthInches')} for="rack-type-width" required>
				<span id="rack-type-width" class="rack-type-fixed-width">
					19
				</span>
			</Field>
			<TextField
				id="rack-type-height"
				label={t('common.heightU')}
				required
				inputmode="numeric"
				value={height()}
				onInput={setHeight}
				placeholder="42"
			/>
			<TextAreaField
				id="rack-type-description"
				label={t('common.description')}
				value={description()}
				onInput={setDescription}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
			/>
			<FormError message={error} />
			<FormActions saving={saving()} cancelTo="/rack-types" />
		</FormPage>
	)
}
