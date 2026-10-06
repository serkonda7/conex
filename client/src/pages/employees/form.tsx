import { emailDomain, withEmailDomain } from 'shared/src/schemas'
import type { ContactScope, EmployeeCreate, EmployeeEmail, EmployeePhone } from 'shared/src/types'
import { createSignal, type JSX } from 'solid-js'
import {
	create_employee,
	type EmployeeRow,
	fetch_employee,
	update_employee,
} from '../../api/employees'
import { fetch_tenants } from '../../api/tenancy'
import {
	ContactListField,
	EmailInput,
	emailsOf,
	PhoneInputs,
	type PhoneRow,
	phoneRow,
	phonesOf,
	RowSelect,
} from '../../components/contacts'
import {
	CheckboxField,
	CommentsField,
	DescriptionField,
	FormPage,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { contactScopeOptions, employeeSalutationOptions } from '../../i18n/labels'
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
import { parseId } from '../../lib/router'
import { useTenantDefault } from '../../lib/tenant_context'

const blankEmail = (): EmployeeEmail => ({ address: '', scope: 'work' })
const blankPhone = (): PhoneRow<EmployeePhone> => ({ number: '', type: 'phone', scope: 'work' })

/** Employee create (`id` omitted) or edit form. */
function EmployeeForm(props: { id?: number }): JSX.Element {
	const [firstName, setFirstName] = createSignal('')
	const [lastName, setLastName] = createSignal('')
	const [salutation, setSalutation] = createSignal('')
	const [title, setTitle] = createSignal('')
	const [emails, setEmails] = createSignal<EmployeeEmail[]>([blankEmail()])
	const [phones, setPhones] = createSignal<PhoneRow<EmployeePhone>[]>([blankPhone()])
	const [active, setActive] = createSignal(true)
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_employee,
		fill: (row: EmployeeRow) => {
			setFirstName(row.first_name ?? '')
			setLastName(row.last_name)
			setSalutation(row.salutation ?? '')
			tenant.pick(id_value(row.tenant_id))
			setTitle(row.title ?? '')
			setEmails(row.emails.length > 0 ? row.emails : [blankEmail()])
			setPhones(row.phones.length > 0 ? row.phones.map(phoneRow) : [blankPhone()])
			setActive(row.active === 1)
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
		},
	})
	const [tenants] = createRows(fetch_tenants, form.setError)
	const tenant = useTenantDefault(
		() => null,
		() => !form.editing,
	)
	/** Company mail domain of the tenant, from its primary mail address. */
	const domainOf = (tenantId: number | null): string | null =>
		emailDomain(tenants()?.find((row) => row.id === tenantId)?.emails ?? [])
	const emailPlaceholder = (): string | undefined => {
		const domain = domainOf(parseId(tenant.value()))
		return domain === null ? undefined : t('employee.emailPlaceholder', { domain })
	}
	const completeEmail = (index: number): void => {
		const domain = domainOf(parseId(tenant.value()))
		setEmails(
			emails().map((e, i) =>
				i === index ? { ...e, address: withEmailDomain(e.address, domain) } : e,
			),
		)
	}
	const prefix = form.editing ? 'employee-edit' : 'employee'
	const detailRoute = props.id === undefined ? '/employees' : `/employees/${props.id}`

	const body = (values: FormValues, tenantId: number): EmployeeCreate => ({
		first_name: text(firstName()),
		last_name: values.name,
		salutation: (salutation() || null) as EmployeeCreate['salutation'],
		tenant_id: tenantId,
		title: text(title()),
		// Rows left blank are dropped; addresses without a domain get the tenant's.
		emails: emailsOf(
			emails().map((e) => ({
				...e,
				address: withEmailDomain(e.address, domainOf(tenantId)),
			})),
		),
		phones: phonesOf(phones()),
		active: active(),
		description: text(description()),
		comments: text(comments()),
	})

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		const tenantId = parseId(tenant.value())
		await submit_form({
			form,
			// The last name is the required name part.
			name: lastName(),
			nameError: t('employee.lastNameRequired'),
			validate: () => (tenantId === null ? t('employee.tenantRequired') : null),
			save: (values: FormValues) =>
				id === undefined
					? create_employee(body(values, tenantId ?? 0))
					: update_employee(id, cleared(body(values, tenantId ?? 0))),
			navigateTo: detailRoute,
			onSuccess: is_add_another_submit(e)
				? () => {
						setFirstName('')
						setLastName('')
						setSalutation('')
						setTitle('')
						setEmails([blankEmail()])
						setPhones([blankPhone()])
					}
				: undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('employee.editTitle') : t('employee.addTitle')}
			name={form.record()?.name}
			loadingText={t('employee.loadingOne')}
			cancelTo={detailRoute}
			onSubmit={handleSubmit}
		>
			<SelectField
				id={`${prefix}-salutation`}
				label={t('employee.salutation')}
				value={salutation()}
				onChange={setSalutation}
				options={employeeSalutationOptions()}
				emptyLabel={t('employee.noSalutation')}
			/>
			<TextField
				id={`${prefix}-first-name`}
				label={t('employee.firstName')}
				placeholder={t('employee.firstNamePlaceholder')}
				maxLength={100}
				value={firstName()}
				onInput={setFirstName}
				autofocus={!form.editing}
			/>
			<TextField
				id={`${prefix}-last-name`}
				label={t('employee.lastName')}
				placeholder={t('employee.lastNamePlaceholder')}
				maxLength={100}
				required
				value={lastName()}
				onInput={setLastName}
			/>
			<SelectField
				id={`${prefix}-tenant`}
				label={tp('entity.tenant', 1)}
				value={tenant.value()}
				onChange={tenant.pick}
				options={row_options(tenants() ?? [])}
				required
			/>
			<TextField
				id={`${prefix}-title`}
				label={t('employee.title')}
				placeholder={t('employee.titlePlaceholder')}
				maxLength={200}
				value={title()}
				onInput={setTitle}
			/>
			<ContactListField
				id={`${prefix}-email`}
				label={t('employee.emails')}
				addLabel={t('employee.addEmail')}
				rows={emails()}
				onChange={setEmails}
				blank={blankEmail}
				row={(
					entry: () => EmployeeEmail,
					update: (patch: Partial<EmployeeEmail>) => void,
					index: number,
				): JSX.Element => (
					<>
						<EmailInput
							id={`${prefix}-email-${index}`}
							placeholder={emailPlaceholder()}
							value={entry().address}
							onInput={(address: string) => update({ address })}
							onComplete={() => completeEmail(index)}
						/>
						<RowSelect
							label={t('employee.contactScope')}
							value={entry().scope}
							options={contactScopeOptions()}
							onChange={(scope: ContactScope) => update({ scope })}
						/>
					</>
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
					entry: () => PhoneRow<EmployeePhone>,
					update: (patch: Partial<PhoneRow<EmployeePhone>>) => void,
					index: number,
				): JSX.Element => (
					<>
						<PhoneInputs
							id={`${prefix}-phone-${index}`}
							entry={entry}
							update={update}
						/>
						<RowSelect
							label={t('employee.contactScope')}
							value={entry().scope}
							options={contactScopeOptions()}
							onChange={(scope: ContactScope) => update({ scope })}
						/>
					</>
				)}
			/>
			<CheckboxField
				id={`${prefix}-active`}
				label={t('employee.active')}
				checked={active()}
				onChange={setActive}
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

/** /employees/add — employee create form; `?tenant=` preselects the tenant. */
export function EmployeeAddPage(): JSX.Element {
	return <EmployeeForm />
}

/** /employees/:id/edit — employee edit form. Saves back to the detail page. */
export function EmployeeEditPage(props: { id: number }): JSX.Element {
	return <EmployeeForm id={props.id} />
}
