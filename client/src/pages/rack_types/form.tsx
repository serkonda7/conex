import { createSignal, type JSX } from 'solid-js'
import {
	create_rack_type,
	fetch_manufacturers,
	fetch_rack_type,
	type RackFormFactor,
	type RackTypeRow,
	update_rack_type,
} from '../../api/templates'
import {
	CommentsField,
	DescriptionField,
	Field,
	FormPage,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { formFactorOptions } from '../../i18n/labels'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId, queryParam, useFormReturnRoute } from '../../lib/router'

/** Rack type create (`id` omitted) or edit form, NetBox-compatible. */
function RackTypeForm(props: { id?: number }): JSX.Element {
	const [manufacturerId, setManufacturerId] = createSignal('')
	// `?name=` comes from the search typed into an opener's dropdown.
	const [model, setModel] = createSignal(queryParam('name'))
	const [description, setDescription] = createSignal('')
	const [formFactor, setFormFactor] = createSignal<RackFormFactor | ''>('')
	const [height, setHeight] = createSignal('1')
	const [partNumber, setPartNumber] = createSignal('')
	const [specUrl, setSpecUrl] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_rack_type,
		fill: (row: RackTypeRow) => {
			setManufacturerId(String(row.manufacturer_id))
			setModel(row.model)
			setFormFactor(row.form_factor as RackFormFactor)
			setHeight(String(row.u_height))
			setPartNumber(row.part_number ?? '')
			setSpecUrl(row.spec_url ?? '')
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
		},
	})
	const prefix = form.editing ? 'rack-type-edit' : 'rack-type'
	const backTo = useFormReturnRoute('/rack-types', props.id)
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
		setPartNumber('')
		setSpecUrl('')
		setComments('')
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		await submit_form({
			form,
			name: model(),
			nameError: t('deviceType.modelRequired'),
			validate,
			save: (values: FormValues) => {
				const body = {
					manufacturer_id: Number(manufacturerId()),
					model: values.name,
					form_factor: formFactor() as RackFormFactor,
					u_height: Number(height()),
				}
				return id === undefined
					? create_rack_type({
							...body,
							part_number: text(partNumber()),
							spec_url: text(specUrl()),
							description: text(description()),
							comments: text(comments()),
						})
					: update_rack_type(id, {
							...body,
							part_number: text(partNumber()) ?? null,
							spec_url: text(specUrl()) ?? null,
							description: text(description()) ?? null,
							comments: text(comments()) ?? null,
						})
			},
			navigateTo: backTo(),
			onSuccess: is_add_another_submit(e) ? resetForNext : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('rackType.editTitle') : t('rackType.addTitle')}
			name={form.record()?.model}
			loadingText={t('rackType.loadingOne')}
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
				add={{ label: tp('entity.manufacturer', 1), href: '/manufacturers/add' }}
				reload={refetchManufacturers}
				autofocus={!form.editing}
			/>
			<TextField
				id={`${prefix}-model`}
				label={t('common.model')}
				required
				value={model()}
				onInput={setModel}
				placeholder={t('rackType.modelPlaceholder')}
			/>
			<SelectField
				id={`${prefix}-form-factor`}
				label={t('rackType.formFactor')}
				required
				value={formFactor()}
				onChange={(value: string) => setFormFactor(value as RackFormFactor | '')}
				options={formFactorOptions()}
				emptyLabel={t('rackType.formFactorPlaceholder')}
				info
			/>
			<Field label={t('rackType.widthInches')} for={`${prefix}-width`} required>
				<span id={`${prefix}-width`} class="rack-type-fixed-width">
					19
				</span>
			</Field>
			<TextField
				id={`${prefix}-height`}
				label={t('common.heightU')}
				required
				inputmode="numeric"
				value={height()}
				onInput={setHeight}
				placeholder="42"
			/>
			<TextField
				id={`${prefix}-part-number`}
				label={t('deviceType.partNumber')}
				maxLength={100}
				value={partNumber()}
				onInput={setPartNumber}
			/>
			<TextField
				id={`${prefix}-spec-url`}
				label={t('deviceType.specUrl')}
				placeholder={t('deviceType.specUrlPlaceholder')}
				maxLength={200}
				value={specUrl()}
				onInput={setSpecUrl}
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

/** /rack-types/add — rack type create form. */
export function RackTypeAddPage(): JSX.Element {
	return <RackTypeForm />
}

/** /rack-types/:id/edit — rack type edit form. Saves back to the list when opened from it, else to the detail page. */
export function RackTypeEditPage(props: { id: number }): JSX.Element {
	return <RackTypeForm id={props.id} />
}
