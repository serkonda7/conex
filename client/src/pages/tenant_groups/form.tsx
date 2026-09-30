import type { TenantGroupCreate } from 'shared/src/types'
import { createSignal, type JSX } from 'solid-js'
import {
	create_tenant_group,
	fetch_tenant_group,
	type TenantGroupRow,
	update_tenant_group,
} from '../../api/tenancy'
import {
	CommentsField,
	DescriptionField,
	FormPage,
	NameField,
	SlugField,
} from '../../components/form'
import { t } from '../../i18n'
import {
	cleared,
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	use_slug_fields,
	useEntityForm,
} from '../../lib/form'

/** Tenant group create (`id` omitted) or edit form. */
function TenantGroupForm(props: { id?: number }): JSX.Element {
	const slugFields = use_slug_fields()
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_tenant_group,
		fill: (row: TenantGroupRow) => {
			slugFields.fill(row.name, row.slug)
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
		},
	})
	const prefix = form.editing ? 'tenant-group-edit' : 'tenant-group'
	const detailRoute = props.id === undefined ? '/tenant-groups' : `/tenant-groups/${props.id}`

	const body = (values: FormValues): TenantGroupCreate => ({
		name: values.name,
		slug: values.slug,
		description: text(description()),
		comments: text(comments()),
	})

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		await submit_form({
			form,
			name: slugFields.name(),
			slug: slugFields.slug(),
			save: (values: FormValues) =>
				id === undefined
					? create_tenant_group(body(values))
					: update_tenant_group(id, cleared(body(values))),
			navigateTo: detailRoute,
			onSuccess: is_add_another_submit(e) ? slugFields.resetName : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('tenantGroup.editTitle') : t('tenantGroup.addTitle')}
			name={form.record()?.name}
			loadingText={t('tenantGroup.loadingOne')}
			cancelTo={detailRoute}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('tenantGroup.namePlaceholder')}
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus={!form.editing}
			/>
			<SlugField
				id={`${prefix}-slug`}
				placeholder={t('tenantGroup.slugPlaceholder')}
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
				editing={form.editing}
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

/** /tenant-groups/add — tenant group create form. */
export function TenantGroupAddPage(): JSX.Element {
	return <TenantGroupForm />
}

/** /tenant-groups/:id/edit — tenant group edit form. Saves back to the detail page. */
export function TenantGroupEditPage(props: { id: number }): JSX.Element {
	return <TenantGroupForm id={props.id} />
}
