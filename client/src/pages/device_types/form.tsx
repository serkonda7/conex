import { createSignal, type JSX } from 'solid-js'
import {
	type DeviceTypeRow,
	fetch_device_type,
	fetch_manufacturers,
	update_device_type,
} from '../../api/templates'
import {
	CheckboxField,
	CommentsField,
	DescriptionField,
	FormPage,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import {
	cleared,
	type FormValues,
	id_value,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId, useFormReturnRoute } from '../../lib/router'

const MAX_HEIGHT = 60

/** Fields this form edits; the rack-only ones stay untouched. */
interface DeviceTypeBody {
	manufacturer_id: number
	model: string
	u_height: number
	is_full_depth: boolean
	description?: string
	comments?: string
}

/**
 * /device-types/:id/edit — device-type edit form. Saves back to the list when
 * opened from it, else to the detail page. New device types are created via
 * the /device-types/import page only.
 */
export function DeviceTypeEditPage(props: { id: number }): JSX.Element {
	const [manufacturerId, setManufacturerId] = createSignal('')
	const [model, setModel] = createSignal('')
	const [uHeight, setUHeight] = createSignal('1')
	const [fullDepth, setFullDepth] = createSignal(false)
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_device_type,
		fill: (row: DeviceTypeRow) => {
			setManufacturerId(id_value(row.manufacturer_id))
			setModel(row.model)
			setUHeight(String(row.u_height))
			setFullDepth(Boolean(row.is_full_depth))
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
		},
	})
	const [manufacturers, { refetch: refetchManufacturers }] = createRows(
		fetch_manufacturers,
		form.setError,
	)
	const prefix = 'device-type-edit'
	const backTo = useFormReturnRoute('/device-types', props.id)

	function validate(): string | null {
		if (parseId(manufacturerId()) === null) {
			return t('deviceType.selectManufacturer')
		}
		const height = Number(uHeight())
		if (!Number.isInteger(height) || height < 0 || height > MAX_HEIGHT) {
			return t('deviceType.heightRange', { min: 0, max: MAX_HEIGHT })
		}
		return null
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const body = (values: FormValues): DeviceTypeBody => ({
			manufacturer_id: Number(manufacturerId()),
			model: values.name,
			u_height: Number(uHeight()),
			is_full_depth: fullDepth(),
			description: text(description()),
			comments: text(comments()),
		})
		await submit_form({
			form,
			name: model(),
			nameError: t('deviceType.modelRequired'),
			validate,
			save: (values: FormValues) => update_device_type(props.id, cleared(body(values))),
			navigateTo: backTo(),
		})
	}

	return (
		<FormPage
			form={form}
			title={t('deviceType.editTitle')}
			name={form.record()?.model}
			loadingText={t('deviceType.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSubmit}
		>
			<SelectField
				id={`${prefix}-manufacturer`}
				label={tp('entity.manufacturer', 1)}
				required
				value={manufacturerId()}
				onChange={setManufacturerId}
				options={row_options(manufacturers() ?? [])}
				emptyLabel={t('deviceType.manufacturerPlaceholder')}
				reload={refetchManufacturers}
			/>
			<TextField
				id={`${prefix}-model`}
				label={t('common.model')}
				placeholder={t('deviceType.modelPlaceholder')}
				maxLength={100}
				required
				value={model()}
				onInput={setModel}
			/>
			<TextField
				id={`${prefix}-u-height`}
				label={t('common.heightU')}
				type="number"
				placeholder="1"
				required
				min={0}
				max={MAX_HEIGHT}
				step={1}
				inputmode="numeric"
				value={uHeight()}
				onInput={setUHeight}
			/>
			<CheckboxField
				id={`${prefix}-full-depth`}
				label={t('common.fullDepth')}
				checked={fullDepth()}
				onChange={setFullDepth}
			/>
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>
			<CommentsField id={`${prefix}-comments`} value={comments()} onInput={setComments} />
		</FormPage>
	)
}
