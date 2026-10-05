import { createSignal, type JSX } from 'solid-js'
import {
	create_manufacturer,
	fetch_manufacturer,
	type ManufacturerRow,
	update_manufacturer,
} from '../../api/templates'
import { DescriptionField, FormPage, NameField } from '../../components/form'
import { t } from '../../i18n'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { queryParam } from '../../lib/router'

/** Manufacturer create (`id` omitted) or edit form. */
function ManufacturerForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [description, setDescription] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_manufacturer,
		fill: (row: ManufacturerRow) => {
			setName(row.name)
			setDescription(row.description ?? '')
		},
	})
	const prefix = form.editing ? 'manufacturer-edit' : 'manufacturer'
	const detailRoute = props.id === undefined ? '/manufacturers' : `/manufacturers/${props.id}`

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		await submit_form({
			form,
			name: name(),
			save: ({ name: trimmed }: FormValues) =>
				id === undefined
					? create_manufacturer({ name: trimmed, description: text(description()) })
					: update_manufacturer(id, {
							name: trimmed,
							description: text(description()) ?? null,
						}),
			navigateTo: detailRoute,
			onSuccess: is_add_another_submit(e)
				? (): void => {
						setName('')
						setDescription('')
					}
				: undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('manufacturer.editTitle') : t('manufacturer.addTitle')}
			name={form.record()?.name}
			loadingText={t('manufacturer.loadingOne')}
			cancelTo={detailRoute}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('manufacturer.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus={!form.editing}
			/>
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>
		</FormPage>
	)
}

/** /manufacturers/add — manufacturer create form. */
export function ManufacturerAddPage(): JSX.Element {
	return <ManufacturerForm />
}

/** /manufacturers/:id/edit — manufacturer edit form. Saves back to the detail page. */
export function ManufacturerEditPage(props: { id: number }): JSX.Element {
	return <ManufacturerForm id={props.id} />
}
