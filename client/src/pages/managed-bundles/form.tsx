import { createSignal, type JSX } from 'solid-js'
import {
	create_managed_bundle,
	fetch_managed_bundle,
	type ManagedBundleRow,
	update_managed_bundle,
} from '../../api/service_catalog'
import { DescriptionField, FormPage, NameField } from '../../components/form'
import { t } from '../../i18n'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { queryParam, useFormReturnRoute } from '../../lib/router'

/** Managed bundle create (`id` omitted) or edit form. */
function ManagedBundleForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [description, setDescription] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_managed_bundle,
		fill: (row: ManagedBundleRow) => {
			setName(row.name)
			setDescription(row.description ?? '')
		},
	})
	const prefix = form.editing ? 'managed-bundle-edit' : 'managed-bundle'
	const backTo = useFormReturnRoute('/managed-bundles', props.id)

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		await submit_form({
			form,
			name: name(),
			save: ({ name: trimmed }: FormValues) =>
				id === undefined
					? create_managed_bundle({ name: trimmed, description: text(description()) })
					: update_managed_bundle(id, {
							name: trimmed,
							description: text(description()) ?? null,
						}),
			navigateTo: backTo(),
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
			title={form.editing ? t('managedBundle.editTitle') : t('managedBundle.addTitle')}
			name={form.record()?.name}
			loadingText={t('managedBundle.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('managedBundle.namePlaceholder')}
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

/** /managed-bundles/add — managed bundle create form. */
export function ManagedBundleAddPage(): JSX.Element {
	return <ManagedBundleForm />
}

/** /managed-bundles/:id/edit — managed bundle edit form. Saves back to the list when opened from it. */
export function ManagedBundleEditPage(props: { id: number }): JSX.Element {
	return <ManagedBundleForm id={props.id} />
}
