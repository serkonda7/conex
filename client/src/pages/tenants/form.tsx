import { Result } from 'better-result'
import type { TenantCreate, TenantEmail, TenantPhone } from 'shared/src/types'
import { createSignal, type JSX } from 'solid-js'
import {
	create_tenant,
	fetch_tenant,
	fetch_tenant_groups,
	type TenantRow,
	update_tenant,
} from '../../api/tenancy'
import {
	ContactListField,
	EmailInput,
	emailsOf,
	PhoneInputs,
	type PhoneRow,
	phoneRow,
	phonesOf,
} from '../../components/contacts'
import {
	CommentsField,
	DescriptionField,
	FormPage,
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
import { contextGroupId, refreshTenantContext, setTenantContext } from '../../lib/tenant_context'

const blankEmail = (): TenantEmail => ({ address: '' })
const blankPhone = (): PhoneRow<TenantPhone> => ({ number: '', type: 'phone' })

/** Tenant create (`id` omitted) or edit form. */
function TenantForm(props: { id?: number }): JSX.Element {
	// Opened from the top-bar selector: prefill its search and select the
	// new tenant as context once created.
	const [name, setName] = createSignal(queryParam('name'))
	const selectAfterCreate = queryParam('select') === '1'
	// A selected tenant-group context preselects that group.
	const [groupId, setGroupId] = createSignal(id_value(contextGroupId()))
	const [customerNumber, setCustomerNumber] = createSignal('')
	const [website, setWebsite] = createSignal('')
	const [emails, setEmails] = createSignal<TenantEmail[]>([blankEmail()])
	const [phones, setPhones] = createSignal<PhoneRow<TenantPhone>[]>([blankPhone()])
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_tenant,
		fill: (row: TenantRow) => {
			setName(row.name)
			setGroupId(id_value(row.tenant_group_id))
			setCustomerNumber(row.customer_number ?? '')
			setWebsite(row.website ?? '')
			setEmails(row.emails.length > 0 ? row.emails : [blankEmail()])
			setPhones(row.phones.length > 0 ? row.phones.map(phoneRow) : [blankPhone()])
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
		customer_number: text(customerNumber()),
		website: text(website()),
		// Rows left blank are dropped.
		emails: emailsOf(emails()),
		phones: phonesOf(phones()),
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
			onSuccess: is_add_another_submit(e)
				? () => {
						setName('')
						setEmails([blankEmail()])
						setPhones([blankPhone()])
					}
				: undefined,
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
			/>
			<TextField
				id={`${prefix}-customer-number`}
				label={t('tenant.customerNumber')}
				placeholder={t('tenant.customerNumberPlaceholder')}
				maxLength={100}
				value={customerNumber()}
				onInput={setCustomerNumber}
			/>
			<TextField
				id={`${prefix}-website`}
				label={t('tenant.website')}
				placeholder={t('tenant.websitePlaceholder')}
				maxLength={200}
				value={website()}
				onInput={setWebsite}
			/>
			<ContactListField
				id={`${prefix}-email`}
				label={t('employee.emails')}
				addLabel={t('employee.addEmail')}
				rows={emails()}
				onChange={setEmails}
				blank={blankEmail}
				row={(
					entry: () => TenantEmail,
					update: (patch: Partial<TenantEmail>) => void,
					index: number,
				): JSX.Element => (
					<EmailInput
						id={`${prefix}-email-${index}`}
						value={entry().address}
						onInput={(address: string) => update({ address })}
					/>
				)}
			/>
			<ContactListField
				id={`${prefix}-phone`}
				label={t('employee.phones')}
				addLabel={t('employee.addPhone')}
				rows={phones()}
				onChange={setPhones}
				blank={blankPhone}
				row={(
					entry: () => PhoneRow<TenantPhone>,
					update: (patch: Partial<PhoneRow<TenantPhone>>) => void,
					index: number,
				): JSX.Element => (
					<PhoneInputs id={`${prefix}-phone-${index}`} entry={entry} update={update} />
				)}
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
