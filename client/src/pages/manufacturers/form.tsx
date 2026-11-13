import { createSignal, type JSX } from 'solid-js'
import {
	create_manufacturer,
	fetch_manufacturer,
	type ManufacturerRow,
	update_manufacturer,
} from '../../api/templates'
import {
	CommentsField,
	DescriptionField,
	FormPage,
	NameField,
	TextField,
} from '../../components/form'
import { t } from '../../i18n'
import { type FormValues, submit_entity_form, text, useEntityForm } from '../../lib/form'
import { queryParam, useFormReturnRoute } from '../../lib/router'

/** Manufacturer create (`id` omitted) or edit form. */
function ManufacturerForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [description, setDescription] = createSignal('')
	const [website, setWebsite] = createSignal('')
	const [supportUrl, setSupportUrl] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_manufacturer,
		fill: (row: ManufacturerRow) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setWebsite(row.website ?? '')
			setSupportUrl(row.support_url ?? '')
			setComments(row.comments ?? '')
		},
	})
	const prefix = form.editing ? 'manufacturer-edit' : 'manufacturer'
	const backTo = useFormReturnRoute('/manufacturers', props.id)

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		await submit_entity_form(e, {
			form,
			name: name(),
			body: (values: FormValues) => ({
				name: values.name,
				description: text(description()),
				website: text(website()),
				support_url: text(supportUrl()),
				comments: text(comments()),
			}),
			create: create_manufacturer,
			update: update_manufacturer,
			navigateTo: backTo(),
			reset: () => {
				setName('')
				setDescription('')
				setWebsite('')
				setSupportUrl('')
				setComments('')
			},
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('manufacturer.editTitle') : t('manufacturer.addTitle')}
			name={form.record()?.name}
			loadingText={t('manufacturer.loadingOne')}
			cancelTo={backTo()}
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
			<TextField
				id={`${prefix}-website`}
				label={t('manufacturer.website')}
				placeholder={t('manufacturer.websitePlaceholder')}
				maxLength={200}
				value={website()}
				onInput={setWebsite}
			/>
			<TextField
				id={`${prefix}-support-url`}
				label={t('manufacturer.supportUrl')}
				placeholder={t('manufacturer.supportUrlPlaceholder')}
				maxLength={200}
				value={supportUrl()}
				onInput={setSupportUrl}
			/>
			<CommentsField id={`${prefix}-comments`} value={comments()} onInput={setComments} />
		</FormPage>
	)
}

/** /manufacturers/add — manufacturer create form. */
export function ManufacturerAddPage(): JSX.Element {
	return <ManufacturerForm />
}

/** /manufacturers/:id/edit — manufacturer edit form. Saves back to the list when opened from it, else to the detail page. */
export function ManufacturerEditPage(props: { id: number }): JSX.Element {
	return <ManufacturerForm id={props.id} />
}
