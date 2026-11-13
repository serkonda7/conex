import { createSignal, type JSX } from 'solid-js'
import {
	create_managed_bundle,
	fetch_managed_bundle,
	type ManagedBundleRow,
	update_managed_bundle,
} from '../../api/service_catalog'
import { DescriptionField, FormPage, Hint, NameField } from '../../components/form'
import { t } from '../../i18n'
import { type FormValues, submit_entity_form, text, useEntityForm } from '../../lib/form'
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
		await submit_entity_form(e, {
			form,
			name: name(),
			body: (values: FormValues) => ({
				name: values.name,
				description: text(description()),
			}),
			create: create_managed_bundle,
			update: update_managed_bundle,
			navigateTo: backTo(),
			reset: () => {
				setName('')
				setDescription('')
			},
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
			<Hint>{t('managedBundle.rolesHint')}</Hint>
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
