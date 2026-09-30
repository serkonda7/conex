import type { SiteGroupCreate } from 'shared/src/types'
import { createSignal, type JSX } from 'solid-js'
import {
	create_site_group,
	fetch_site_group,
	fetch_tenants,
	type SiteGroupRow,
	update_site_group,
} from '../../api/tenancy'
import {
	CommentsField,
	DescriptionField,
	FormPage,
	NameField,
	row_options,
	SelectField,
	SlugField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import {
	cleared,
	type FormValues,
	id_value,
	is_add_another_submit,
	submit_form,
	text,
	use_slug_fields,
	useEntityForm,
} from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { contextTenantValue } from '../../lib/tenant_context'

/** Site group create (`id` omitted) or edit form. */
function SiteGroupForm(props: { id?: number }): JSX.Element {
	const slugFields = use_slug_fields()
	// A single-tenant context preselects that tenant.
	const [tenantId, setTenantId] = createSignal(contextTenantValue())
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_site_group,
		fill: (row: SiteGroupRow) => {
			slugFields.fill(row.name, row.slug)
			setTenantId(id_value(row.tenant_id))
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
		},
	})
	const [tenants] = createRows(fetch_tenants, form.setError)
	const prefix = form.editing ? 'site-group-edit' : 'site-group'
	const detailRoute = props.id === undefined ? '/site-groups' : `/site-groups/${props.id}`

	const body = (values: FormValues): SiteGroupCreate => ({
		name: values.name,
		slug: values.slug,
		tenant_id: parseId(tenantId()),
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
					? create_site_group(body(values))
					: update_site_group(id, cleared(body(values))),
			navigateTo: detailRoute,
			onSuccess: is_add_another_submit(e) ? slugFields.resetName : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('siteGroup.editTitle') : t('siteGroup.addTitle')}
			name={form.record()?.name}
			loadingText={t('siteGroup.loadingOne')}
			cancelTo={detailRoute}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('siteGroup.namePlaceholder')}
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus={!form.editing}
			/>
			<SlugField
				id={`${prefix}-slug`}
				placeholder={t('siteGroup.slugPlaceholder')}
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
				editing={form.editing}
			/>
			<SelectField
				id={`${prefix}-tenant`}
				label={tp('entity.tenant', 1)}
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
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

/** /site-groups/add — flat site group create form. */
export function SiteGroupAddPage(): JSX.Element {
	return <SiteGroupForm />
}

/** /site-groups/:id/edit — site group edit form. Saves back to the detail page. */
export function SiteGroupEditPage(props: { id: number }): JSX.Element {
	return <SiteGroupForm id={props.id} />
}
