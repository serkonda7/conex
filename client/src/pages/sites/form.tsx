import type { InputEventAndTarget, SiteCreate } from 'shared/src/types'
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
	Field,
	FormPage,
	FormSection,
	NameField,
	row_options,
	SelectField,
	TextField,
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

/** Street, postcode and city of one site address. */
interface Address {
	street: string
	postcode: string
	city: string
}

const blankAddress = (): Address => ({ street: '', postcode: '', city: '' })

/** Titled street / postcode / city inputs of one site address. */
function AddressFields(props: {
	id: string
	title: string
	value: Address
	onChange: (value: Address) => void
}): JSX.Element {
	const set = (patch: Partial<Address>): void => props.onChange({ ...props.value, ...patch })
	return (
		<FormSection title={props.title}>
			<TextField
				id={`${props.id}-street`}
				label={t('site.street')}
				placeholder={t('site.streetPlaceholder')}
				maxLength={200}
				autocomplete="off"
				value={props.value.street}
				onInput={(street: string) => set({ street })}
			/>
			<Field label={t('site.postcodeCity')} for={`${props.id}-postcode`}>
				<div class="address-place-row">
					<input
						id={`${props.id}-postcode`}
						class="address-postcode"
						aria-label={t('site.postcode')}
						placeholder={t('site.postcodePlaceholder')}
						maxLength={20}
						autocomplete="off"
						value={props.value.postcode}
						onInput={(e: InputEventAndTarget) =>
							set({ postcode: e.currentTarget.value })
						}
					/>
					<input
						id={`${props.id}-city`}
						aria-label={t('site.city')}
						placeholder={t('site.cityPlaceholder')}
						maxLength={100}
						autocomplete="off"
						value={props.value.city}
						onInput={(e: InputEventAndTarget) => set({ city: e.currentTarget.value })}
					/>
				</div>
			</Field>
		</FormSection>
	)
}

/** Site create (`id` omitted) or edit form. */
function SiteForm(props: { id?: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [groupId, setGroupId] = createSignal(queryParam('group'))
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [physicalAddress, setPhysicalAddress] = createSignal(blankAddress())
	const [shippingAddress, setShippingAddress] = createSignal(blankAddress())
	const form = useEntityForm({
		id: props.id,
		load: fetch_site,
		fill: (row: SiteRow) => {
			setName(row.name)
			tenant.pick(id_value(row.tenant_id))
			setGroupId(id_value(row.site_group_id))
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
			setPhysicalAddress({
				street: row.physical_street ?? '',
				postcode: row.physical_postcode ?? '',
				city: row.physical_city ?? '',
			})
			setShippingAddress({
				street: row.shipping_street ?? '',
				postcode: row.shipping_postcode ?? '',
				city: row.shipping_city ?? '',
			})
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
		physical_street: text(physicalAddress().street),
		physical_postcode: text(physicalAddress().postcode),
		physical_city: text(physicalAddress().city),
		shipping_street: text(shippingAddress().street),
		shipping_postcode: text(shippingAddress().postcode),
		shipping_city: text(shippingAddress().city),
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
			<AddressFields
				id={`${prefix}-physical`}
				title={t('site.physicalAddress')}
				value={physicalAddress()}
				onChange={setPhysicalAddress}
			/>
			<AddressFields
				id={`${prefix}-shipping`}
				title={t('site.shippingAddress')}
				value={shippingAddress()}
				onChange={setShippingAddress}
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
