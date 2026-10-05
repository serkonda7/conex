import { createSignal, type JSX } from 'solid-js'
import { create_device_type, fetch_manufacturers, type RackFormFactor } from '../../api/templates'
import {
	Field,
	FormPage,
	row_options,
	SelectField,
	TextAreaField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { formFactorLabel } from '../../i18n/labels'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useFormState,
} from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId, queryParam } from '../../lib/router'

const FORM_FACTORS: RackFormFactor[] = [
	'2-post frame',
	'4-post frame',
	'4-post cabinet',
	'wall-mounted frame',
	'wall-mounted cabinet',
]

/** /rack-types/add — create a NetBox-compatible rack type. */
export function RackTypeAddPage(): JSX.Element {
	const form = useFormState()
	const [manufacturerId, setManufacturerId] = createSignal('')
	// `?name=` comes from the search typed into an opener's dropdown.
	const [model, setModel] = createSignal(queryParam('name'))
	const [description, setDescription] = createSignal('')
	const [formFactor, setFormFactor] = createSignal<RackFormFactor | ''>('')
	const [height, setHeight] = createSignal('1')
	const [manufacturers, { refetch: refetchManufacturers }] = createRows(
		fetch_manufacturers,
		form.setError,
	)

	function validate(): string | null {
		const rackHeight = Number(height())
		if (parseId(manufacturerId()) === null) {
			return t('deviceType.selectManufacturer')
		}
		if (!formFactor()) {
			return t('rackType.selectFormFactor')
		}
		if (!Number.isInteger(rackHeight) || rackHeight < 1 || rackHeight > 60) {
			return t('rackType.heightRange')
		}
		return null
	}

	function resetForNext(): void {
		setModel('')
		setDescription('')
		setFormFactor('')
		setHeight('1')
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: model(),
			nameError: t('deviceType.modelRequired'),
			validate,
			save: (values: FormValues) =>
				create_device_type({
					manufacturer_id: Number(manufacturerId()),
					model: values.name,
					description: text(description()),
					form_factor: formFactor() || undefined,
					width: 19,
					u_height: Number(height()),
				}),
			navigateTo: '/rack-types',
			onSuccess: is_add_another_submit(e) ? resetForNext : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={t('rackType.addTitle')}
			cancelTo="/rack-types"
			onSubmit={handleCreate}
		>
			<SelectField
				id="rack-type-manufacturer"
				label={tp('entity.manufacturer', 1)}
				required
				value={manufacturerId()}
				onChange={setManufacturerId}
				options={row_options(manufacturers() ?? [])}
				emptyLabel={t('deviceType.manufacturerPlaceholder')}
				add={{ label: tp('entity.manufacturer', 1), href: '/manufacturers/add' }}
				reload={refetchManufacturers}
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
				onChange={(value: string) => setFormFactor(value as RackFormFactor | '')}
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
				maxLength={500}
			/>
		</FormPage>
	)
}
