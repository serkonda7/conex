import { Result } from 'better-result'
import type { TenantCreate } from 'shared/src/types'
import { createSignal, type JSX } from 'solid-js'
import {
	create_tenant,
	fetch_tenant,
	fetch_tenant_groups,
	type TenantRow,
	update_tenant,
} from '../../api/tenancy'
import {
	CommentsField,
	DescriptionField,
	FormPage,
	Hint,
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
import { parseId, queryParam } from '../../lib/router'
import { contextGroupId, refreshTenantContext, setTenantContext } from '../../lib/tenant_context'

/** Tenant create (`id` omitted) or edit form. */
function TenantForm(props: { id?: number }): JSX.Element {
	// Opened from the top-bar selector: prefill its search and select the
	// new tenant as context once created.
	const [name, setName] = createSignal(queryParam('name'))
	const selectAfterCreate = queryParam('select') === '1'
	// A selected tenant-group context preselects that group.
	const [groupId, setGroupId] = createSignal(id_value(contextGroupId()))
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_tenant,
		fill: (row: TenantRow) => {
			setName(row.name)
			setGroupId(id_value(row.tenant_group_id))
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
		},
	})
	const [groups] = createRows(fetch_tenant_groups, form.setError)
	const prefix = form.editing ? 'tenant-edit' : 'tenant'
	const detailRoute = props.id === undefined ? '/tenants' : `/tenants/${props.id}`

	const body = (values: FormValues): TenantCreate => ({
		name: values.name,
		tenant_group_id: parseId(groupId()),
		description: text(description()),
		comments: text(comments()),
	})

	async function create(values: FormValues): Promise<Result<TenantRow, Error>> {
		const res = await create_tenant(body(values))
		if (selectAfterCreate && Result.isOk(res)) {
			setTenantContext({ kind: 'tenant', id: res.value.id })
			void refreshTenantContext()
		}
		return res
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		await submit_form({
			form,
			name: name(),
			save: (values: FormValues) =>
				id === undefined ? create(values) : update_tenant(id, cleared(body(values))),
			navigateTo: detailRoute,
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('tenant.editTitle') : t('tenant.addTitle')}
			name={form.record()?.name}
			loadingText={t('tenant.loadingOne')}
			cancelTo={detailRoute}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('tenant.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus={!form.editing}
			/>
			<SelectField
				id={`${prefix}-group`}
				label={tp('entity.tenantGroup', 1)}
				value={groupId()}
				onChange={setGroupId}
				options={row_options(groups() ?? [])}
				emptyLabel={t('common.noGroup')}
				hint={<Hint>{t('tenantGroup.hint')}</Hint>}
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

/** /tenants/add — NetBox-style tenant create form. */
export function TenantAddPage(): JSX.Element {
	return <TenantForm />
}

/** /tenants/:id/edit — tenant edit form. Saves back to the detail page. */
export function TenantEditPage(props: { id: number }): JSX.Element {
	return <TenantForm id={props.id} />
}
