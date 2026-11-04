import { emailDomain, primaryPhone, withEmailDomain } from 'shared/src/schemas'
import type { ContactScope, EmployeeCreate, EmployeeEmail, EmployeePhone } from 'shared/src/types'
import { createSignal, For, type JSX, Show } from 'solid-js'
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
	isLogin,
	isUndialableExtension,
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
	type FormOption,
	FormPage,
	Hint,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { contactScopeOptions, employeeSalutationOptions } from '../../i18n/labels'
import {
	cleared,
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { createRows } from '../../lib/resource'
import { parseId, useFormReturnRoute } from '../../lib/router'
import { can, sessionTenantIds } from '../../lib/session'
import { newObjectTenantId } from '../../lib/tenant_context'

/** One row of the tenant list; `id` is the select value ('' = none chosen). */
interface TenantEntry {
	id: string
}

type SelectEvent = Event & { currentTarget: HTMLSelectElement }

const blankEmail = (): EmployeeEmail => ({ address: '', scope: 'work' })
const blankTenant = (): TenantEntry => ({ id: '' })
const blankPhone = (): PhoneRow<EmployeePhone> => ({ number: '', type: 'phone', scope: 'work' })

/** Employee create (`id` omitted) or edit form. */
function EmployeeForm(props: { id?: number }): JSX.Element {
	const [firstName, setFirstName] = createSignal('')
	const [lastName, setLastName] = createSignal('')
	const [salutation, setSalutation] = createSignal('')
	// Edit only: new employees get the tenant of the global tenant selection.
	// First = primary tenant.
	const [editTenants, setEditTenants] = createSignal<TenantEntry[]>([])
	// Memberships outside a scoped user's tenants: kept as they are.
	const [hiddenTenants, setHiddenTenants] = createSignal<number[]>([])
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
			const scope = sessionTenantIds()
			const visible = (id: number): boolean => scope === null || scope.includes(id)
			setEditTenants(row.tenant_ids.filter(visible).map((id) => ({ id: String(id) })))
			setHiddenTenants(row.tenant_ids.filter((id) => !visible(id)))
			setTitle(row.title ?? '')
			setEmails(row.emails.length > 0 ? row.emails : [blankEmail()])
			setPhones(row.phones.length > 0 ? row.phones.map(phoneRow) : [blankPhone()])
			setActive(row.active === 1)
			setDescription(row.description ?? '')
			setComments(row.comments ?? '')
		},
	})
	const [tenants] = createRows(fetch_tenants, form.setError)
	/** Chosen tenants, in order, without blanks and repeats. */
	const editTenantIds = (): number[] => [
		...new Set(
			editTenants()
				.map((row) => parseId(row.id))
				.filter((id): id is number => id !== null),
		),
	]
	// Memberships also scope the employee's account: `employees.tenants` only.
	const editsTenants = (): boolean => form.editing && can('employees.tenants')
	/** Memberships to save: hidden ones keep their place when primary, else go last. */
	const savedTenantIds = (): number[] => {
		const hidden = hiddenTenants()
		const primary = form.record()?.tenant_ids[0]
		const first = primary !== undefined && hidden.includes(primary) ? [primary] : []
		return [...first, ...editTenantIds(), ...hidden.filter((id) => id !== primary)]
	}
	/** Tenant whose mail domain and main number apply: the primary one. */
	const tenant = (): number | null =>
		editsTenants()
			? (savedTenantIds()[0] ?? null)
			: form.editing
				? (form.record()?.tenant_ids[0] ?? null)
				: newObjectTenantId()
	/** Company mail domain of the tenant, from its primary mail address. */
	const domainOf = (tenantId: number | null): string | null =>
		emailDomain(tenants()?.find((row) => row.id === tenantId)?.emails ?? [])
	const emailPlaceholder = (): string | undefined => {
		const domain = domainOf(tenant())
		return domain === null ? undefined : t('employee.emailPlaceholder', { domain })
	}
	/** Main phone number of the tenant, which extensions are dialed through. */
	const mainNumber = (): string | null =>
		primaryPhone(tenants()?.find((row) => row.id === tenant())?.phones ?? [], 'phone')
	const completeEmail = (index: number): void => {
		const domain = domainOf(tenant())
		setEmails(
			emails().map((e, i) =>
				i === index ? { ...e, address: withEmailDomain(e.address, domain) } : e,
			),
		)
	}
	/** The account's sign-in address cannot be edited or removed here. */
	const isLoginRow = (e: EmployeeEmail): boolean => isLogin(e.address, form.record()?.login)
	const prefix = form.editing ? 'employee-edit' : 'employee'
	const backTo = useFormReturnRoute('/employees', props.id)

	const body = (values: FormValues, tenantId: number): Omit<EmployeeCreate, 'tenant_ids'> => ({
		first_name: text(firstName()),
		last_name: values.name,
		salutation: (salutation() || null) as EmployeeCreate['salutation'],
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
		// Never null here: the form blocks submitting without a tenant.
		const tenantId = tenant() ?? 0
		await submit_form({
			form,
			// The last name is the required name part.
			name: lastName(),
			nameError: t('employee.lastNameRequired'),
			save: (values: FormValues) =>
				id === undefined
					? create_employee({ ...body(values, tenantId), tenant_ids: [tenantId] })
					: update_employee(id, {
							...cleared(body(values, tenantId)),
							...(editsTenants() ? { tenant_ids: savedTenantIds() } : {}),
						}),
			navigateTo: backTo(),
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
			cancelTo={backTo()}
			tenant="required"
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
			<Show when={editsTenants()}>
				<ContactListField
					id={`${prefix}-tenant`}
					label={t('employee.tenants')}
					addLabel={t('employee.addTenant')}
					rows={editTenants()}
					onChange={setEditTenants}
					blank={blankTenant}
					row={(
						entry: () => TenantEntry,
						update: (patch: Partial<TenantEntry>) => void,
						index: number,
					): JSX.Element => (
						<select
							id={`${prefix}-tenant-${index}`}
							aria-label={tp('entity.tenant', 1)}
							value={entry().id}
							required={index === 0}
							onChange={(e: SelectEvent) => update({ id: e.currentTarget.value })}
						>
							<option value="">{t('common.selectPlaceholder')}</option>
							<For each={row_options(tenants() ?? [])}>
								{(o: FormOption): JSX.Element => (
									<option value={o.value}>{o.label}</option>
								)}
							</For>
						</select>
					)}
				/>
			</Show>
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
				locked={(entry: () => EmployeeEmail) =>
					isLoginRow(entry()) ? t('employee.loginLocked') : undefined
				}
				rowHint={(entry: () => EmployeeEmail): JSX.Element => (
					<Show when={isLoginRow(entry())}>
						<Hint>{t('employee.loginAddressHint')}</Hint>
					</Show>
				)}
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
							readOnly={isLoginRow(entry())}
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
				rowHint={(entry: () => PhoneRow<EmployeePhone>): JSX.Element => (
					<Show when={tenant() !== null && isUndialableExtension(entry(), mainNumber())}>
						<p class="field-hint field-hint-error" role="status">
							{t('employee.extensionNoMainNumber')}
						</p>
					</Show>
				)}
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

/** /employees/add — employee create form for the tenant selected in the top bar. */
export function EmployeeAddPage(): JSX.Element {
	return <EmployeeForm />
}

/** /employees/:id/edit — employee edit form. Saves back to the list when opened from it, else to the detail page. */
export function EmployeeEditPage(props: { id: number }): JSX.Element {
	return <EmployeeForm id={props.id} />
}
