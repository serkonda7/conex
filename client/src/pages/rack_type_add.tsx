import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { create_device_type, fetch_manufacturers } from '../api_p3'
import {
	FormActions,
	FormError,
	FormPage,
	row_options,
	SelectField,
	SlugField,
	TextAreaField,
	TextField,
} from '../components/form'
import { navigate } from '../router'

type RackFormFactor =
	| '2-post frame'
	| '4-post frame'
	| '4-post cabinet'
	| 'wall-mounted frame'
	| 'wall-mounted cabinet'
	| 'wall-mounted swing-out'
	| 'outdoor cabinet'

const FORM_FACTORS: RackFormFactor[] = [
	'2-post frame',
	'4-post frame',
	'4-post cabinet',
	'wall-mounted frame',
	'wall-mounted cabinet',
	'wall-mounted swing-out',
	'outdoor cabinet',
]

const WIDTHS = [10, 19, 23] as const

/** /rack-types/add — create a NetBox-compatible rack type. */
export function RackTypeAddPage(): JSX.Element {
	const [manufacturerId, setManufacturerId] = createSignal('')
	const [model, setModel] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [formFactor, setFormFactor] = createSignal<RackFormFactor | ''>('')
	const [width, setWidth] = createSignal('19')
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
			setError('Select a manufacturer.')
			return
		}
		if (!formFactor()) {
			setError('Select a form factor.')
			return
		}
		if (!Number.isInteger(rackHeight) || rackHeight < 1 || rackHeight > 60) {
			setError('Height must be an integer from 1 to 60 U.')
			return
		}
		setSaving(true)
		const res = await create_device_type({
			manufacturer_id: manufacturer,
			model: model().trim(),
			slug: slug().trim(),
			description: description().trim() || undefined,
			form_factor: formFactor() || undefined,
			width: Number(width()) as (typeof WIDTHS)[number],
			u_height: rackHeight,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		navigate('/rack-types')
	}

	return (
		<FormPage
			backTo="/rack-types"
			backLabel="Rack types"
			title="Add a rack type"
			onSubmit={handleCreate}
		>
			<SelectField
				id="rack-type-manufacturer"
				label="Manufacturer"
				required
				value={manufacturerId()}
				onChange={setManufacturerId}
				options={row_options(manufacturers() ?? [])}
				emptyLabel="Manufacturer…"
			/>
			<TextField
				id="rack-type-model"
				label="Model"
				required
				value={model()}
				onInput={setModel}
				placeholder="Example Rack 42U"
				autofocus
			/>
			<SlugField
				id="rack-type-slug"
				value={slug()}
				onInput={setSlug}
				placeholder="example-rack-42u"
			/>
			<TextAreaField
				id="rack-type-description"
				label="Description"
				value={description()}
				onInput={setDescription}
				placeholder="Short summary (optional)"
				maxLength={500}
			/>
			<SelectField
				id="rack-type-form-factor"
				label="Form factor"
				required
				value={formFactor()}
				onChange={setFormFactor}
				options={FORM_FACTORS.map((value) => ({ value, label: value }))}
				emptyLabel="Form factor…"
			/>
			<SelectField
				id="rack-type-width"
				label="Width (inches)"
				required
				value={width()}
				onChange={setWidth}
				options={WIDTHS.map((value) => ({ value, label: String(value) }))}
			/>
			<TextField
				id="rack-type-height"
				label="Height (U)"
				required
				inputmode="numeric"
				value={height()}
				onInput={setHeight}
				placeholder="42"
			/>
			<FormError message={error} />
			<FormActions saving={saving()} cancelTo="/rack-types" />
		</FormPage>
	)
}
