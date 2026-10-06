import { IconPlus, IconTrash } from '@tabler/icons-solidjs'
import { inferPhoneType } from 'shared/src/phone'
import type {
	ContactScope,
	EmployeeCreate,
	EmployeeEmail,
	EmployeePhone,
	InputEventAndTarget,
	PhoneType,
} from 'shared/src/types'
import { createSignal, For, Index, type JSX } from 'solid-js'
import {
	create_employee,
	type EmployeeRow,
	fetch_employee,
	update_employee,
} from '../../api/employees'
import { fetch_tenants } from '../../api/tenancy'
import {
	CheckboxField,
	CommentsField,
	DescriptionField,
	Field,
	FormPage,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { contactScopeOptions, employeeSalutationOptions, phoneTypeOptions } from '../../i18n/labels'
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

type SelectEvent = Event & { currentTarget: HTMLSelectElement }

const blankEmail = (): EmployeeEmail => ({ address: '', scope: 'work' })
/** Phone row being edited; `typePicked` once the type no longer follows the number. */
type PhoneRow = EmployeePhone & { typePicked?: boolean }

const blankPhone = (): PhoneRow => ({ number: '', type: 'phone', scope: 'work' })

/** Loaded rows whose type differs from the inferred one keep it while editing. */
const phoneRow = (p: EmployeePhone): PhoneRow => ({
	...p,
	typePicked: inferPhoneType(p.number) !== p.type,
})

/** Native `<select>` of a contact row. */
function RowSelect<T extends string>(props: {
	label: string
	value: T
	options: { value: T; label: string }[]
	onChange: (value: T) => void
}): JSX.Element {
	return (
		<select
			aria-label={props.label}
			value={props.value}
			onChange={(e: SelectEvent): void => props.onChange(e.currentTarget.value as T)}
		>
			<For each={props.options}>
				{(o: { value: T; label: string }): JSX.Element => (
					<option value={o.value}>{o.label}</option>
				)}
			</For>
		</select>
	)
}

/**
 * Editable list of contact rows (mail addresses or phone numbers): one row
 * per entry with a remove button, plus an add button below. Rows keep their
 * DOM nodes by index, so typing never loses focus.
 */
function ContactListField<T>(props: {
	id: string
	label: string
	addLabel: string
	rows: T[]
	onChange: (rows: T[]) => void
	blank: () => T
	row: (entry: () => T, update: (patch: Partial<T>) => void, index: number) => JSX.Element
}): JSX.Element {
	const update = (index: number, patch: Partial<T>): void =>
		props.onChange(props.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
	return (
		<Field label={props.label} for={`${props.id}-0`}>
			<Index each={props.rows}>
				{(entry: () => T, index: number): JSX.Element => (
					<div class="contact-row">
						{props.row(entry, (patch: Partial<T>) => update(index, patch), index)}
						<button
							type="button"
							class="icon-btn"
							aria-label={t('employee.removeEntry')}
							title={t('employee.removeEntry')}
							onClick={() => props.onChange(props.rows.filter((_, i) => i !== index))}
						>
							<IconTrash size={16} />
						</button>
					</div>
				)}
			</Index>
			<button
				type="button"
				class="contact-add"
				onClick={() => props.onChange([...props.rows, props.blank()])}
			>
				<IconPlus size={14} aria-hidden="true" /> {props.addLabel}
			</button>
		</Field>
	)
}

/** Employee create (`id` omitted) or edit form. */
function EmployeeForm(props: { id?: number }): JSX.Element {
	const [firstName, setFirstName] = createSignal('')
	const [lastName, setLastName] = createSignal('')
	const [salutation, setSalutation] = createSignal('')
	const [title, setTitle] = createSignal('')
	const [emails, setEmails] = createSignal<EmployeeEmail[]>([blankEmail()])
	const [phones, setPhones] = createSignal<PhoneRow[]>([blankPhone()])
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
	const prefix = form.editing ? 'employee-edit' : 'employee'
	const detailRoute = props.id === undefined ? '/employees' : `/employees/${props.id}`

	const body = (values: FormValues, tenantId: number): EmployeeCreate => ({
		first_name: text(firstName()),
		last_name: values.name,
		salutation: (salutation() || null) as EmployeeCreate['salutation'],
		tenant_id: tenantId,
		title: text(title()),
		// Rows left blank are dropped.
		emails: emails()
			.map((e) => ({ ...e, address: e.address.trim() }))
			.filter((e) => e.address !== ''),
		phones: phones()
			.map(({ typePicked: _, ...p }) => ({ ...p, number: p.number.trim() }))
			.filter((p) => p.number !== ''),
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
						<input
							id={`${prefix}-email-${index}`}
							type="email"
							autocomplete="off"
							maxLength={200}
							aria-label={t('employee.email')}
							value={entry().address}
							onInput={(e: InputEventAndTarget) =>
								update({ address: e.currentTarget.value })
							}
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
					entry: () => PhoneRow,
					update: (patch: Partial<PhoneRow>) => void,
					index: number,
				): JSX.Element => (
					<>
						<input
							id={`${prefix}-phone-${index}`}
							type="tel"
							autocomplete="off"
							maxLength={200}
							aria-label={t('employee.phoneNumber')}
							value={entry().number}
							onInput={(e: InputEventAndTarget) => {
								const number = e.currentTarget.value
								const inferred = entry().typePicked ? null : inferPhoneType(number)
								update(inferred === null ? { number } : { number, type: inferred })
							}}
						/>
						<RowSelect
							label={t('employee.phoneType')}
							value={entry().type}
							options={phoneTypeOptions()}
							onChange={(type: PhoneType) => update({ type, typePicked: true })}
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
