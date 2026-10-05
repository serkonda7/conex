import type { SiteCreate } from 'shared/src/types'
import { createMemo, createSignal, type JSX } from 'solid-js'
import {
	create_site,
	fetch_site,
	fetch_site_groups,
	fetch_tenants,
	type SiteRow,
	update_site,
} from '../../api/tenancy'
import {
	CommentsField,
	DescriptionField,
	FormPage,
	NameField,
	row_options,
	SelectField,
	TextAreaField,
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
import { useTenantDefault } from '../../lib/tenant_context'

/** Site create (`id` omitted) or edit form. */
function SiteForm(props: { id?: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [groupId, setGroupId] = createSignal(queryParam('group'))
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [physicalAddress, setPhysicalAddress] = createSignal('')
	const [shippingAddress, setShippingAddress] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_site,
		fill: (row: SiteRow) => {
			setName(row.name)
			tenant.pick(id_value(row.tenant_id))
			setGroupId(id_value(row.site_group_id))
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
			setPhysicalAddress(row.physical_address ?? '')
			setShippingAddress(row.shipping_address ?? '')
		},
	})
	const [tenants] = createRows(fetch_tenants, form.setError)
	const [groups] = createRows(fetch_site_groups, form.setError)
	// New sites default to the tenant of the selected group.
	const groupTenantId = createMemo(() => {
		const id = parseId(groupId())
		return (groups() ?? []).find((g) => g.id === id)?.tenant_id ?? null
	})
	const tenant = useTenantDefault(groupTenantId, () => !form.editing && groups() !== undefined)
	const prefix = form.editing ? 'site-edit' : 'site'
	const detailRoute = props.id === undefined ? '/sites' : `/sites/${props.id}`

	const body = (values: FormValues): SiteCreate => ({
		name: values.name,
		tenant_id: parseId(tenant.value()),
		site_group_id: parseId(groupId()),
		description: text(description()),
		comments: text(comments()),
		physical_address: text(physicalAddress()),
		shipping_address: text(shippingAddress()),
	})

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		await submit_form({
			form,
			name: name(),
			save: (values: FormValues) =>
				id === undefined
					? create_site(body(values))
					: update_site(id, cleared(body(values))),
			navigateTo: detailRoute,
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('site.editTitle') : t('site.addTitle')}
			name={form.record()?.name}
			loadingText={t('site.loadingOne')}
			cancelTo={detailRoute}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('site.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus={!form.editing}
			/>
			<SelectField
				id={`${prefix}-tenant`}
				label={tp('entity.tenant', 1)}
				value={tenant.value()}
				onChange={tenant.pick}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
			/>
			<SelectField
				id={`${prefix}-group`}
				label={t('common.group')}
				value={groupId()}
				onChange={setGroupId}
				options={row_options(groups() ?? [])}
				emptyLabel={t('common.noGroup')}
			/>
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>
			<CommentsField id={`${prefix}-comments`} value={comments()} onInput={setComments} />
			<TextAreaField
				id={`${prefix}-physical-address`}
				label={t('site.physicalAddress')}
				placeholder={t('site.physicalAddressPlaceholder')}
				rows={3}
				maxLength={500}
				value={physicalAddress()}
				onInput={setPhysicalAddress}
			/>
			<TextAreaField
				id={`${prefix}-shipping-address`}
				label={t('site.shippingAddress')}
				placeholder={t('site.shippingAddressPlaceholder')}
				rows={3}
				maxLength={500}
				value={shippingAddress()}
				onInput={setShippingAddress}
			/>
		</FormPage>
	)
}

/** /sites/add — NetBox-style site create form. */
export function SiteAddPage(): JSX.Element {
	return <SiteForm />
}

/** /sites/:id/edit — site edit form. Saves back to the detail page. */
export function SiteEditPage(props: { id: number }): JSX.Element {
	return <SiteForm id={props.id} />
}
