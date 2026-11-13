import type { SiteGroupCreate } from 'shared/src/types'
import { createSignal, type JSX, Show } from 'solid-js'
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
	TenantSelectField,
} from '../../components/form'
import { t } from '../../i18n'
import { type FormValues, id_value, submit_entity_form, text, useEntityForm } from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId, useFormReturnRoute } from '../../lib/router'
import { newObjectTenantId } from '../../lib/tenant_context'

/** Site group create (`id` omitted) or edit form. */
function SiteGroupForm(props: { id?: number }): JSX.Element {
	const [name, setName] = createSignal('')
	// Edit only: new site groups get the tenant of the global tenant selection.
	const [tenantId, setTenantId] = createSignal('')
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
		tenant_id: form.editing ? parseId(tenantId()) : newObjectTenantId(),
		description: text(description()),
		comments: text(comments()),
	})

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		await submit_entity_form(e, {
			form,
			name: name(),
			body,
			create: create_site_group,
			update: update_site_group,
			navigateTo: backTo(),
			reset: () => setName(''),
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('siteGroup.editTitle') : t('siteGroup.addTitle')}
			name={form.record()?.name}
			loadingText={t('siteGroup.loadingOne')}
			cancelTo={backTo()}
			tenant="required"
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('siteGroup.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus={!form.editing}
			/>
			<Show when={form.editing}>
				<TenantSelectField
					id={`${prefix}-tenant`}
					value={tenantId()}
					onChange={setTenantId}
					tenants={tenants()}
				/>
			</Show>
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
