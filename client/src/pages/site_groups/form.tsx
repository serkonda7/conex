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
} from '../../components/form'
import { t, tp } from '../../i18n'
import {
	cleared,
	type FormValues,
	id_value,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId, useFormReturnRoute } from '../../lib/router'
import { contextTenantValue } from '../../lib/tenant_context'

/** Site group create (`id` omitted) or edit form. */
function SiteGroupForm(props: { id?: number }): JSX.Element {
	const [name, setName] = createSignal('')
	// A single-tenant context preselects that tenant.
	const [tenantId, setTenantId] = createSignal(contextTenantValue())
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_site_group,
		fill: (row: SiteGroupRow) => {
			setName(row.name)
			setTenantId(id_value(row.tenant_id))
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
		},
	})
	const [tenants] = createRows(fetch_tenants, form.setError)
	const prefix = form.editing ? 'site-group-edit' : 'site-group'
	const backTo = useFormReturnRoute('/site-groups', props.id)

	const body = (values: FormValues): SiteGroupCreate => ({
		name: values.name,
		tenant_id: parseId(tenantId()),
		description: text(description()),
		comments: text(comments()),
	})

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		await submit_form({
			form,
			name: name(),
			save: (values: FormValues) =>
				id === undefined
					? create_site_group(body(values))
					: update_site_group(id, cleared(body(values))),
			navigateTo: backTo(),
			onSuccess: is_add_another_submit(e)
				? (): void => {
						setName('')
					}
				: undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('siteGroup.editTitle') : t('siteGroup.addTitle')}
			name={form.record()?.name}
			loadingText={t('siteGroup.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('siteGroup.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus={!form.editing}
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

/** /site-groups/:id/edit — site group edit form. Saves back to the list when opened from it, else to the detail page. */
export function SiteGroupEditPage(props: { id: number }): JSX.Element {
	return <SiteGroupForm id={props.id} />
}
