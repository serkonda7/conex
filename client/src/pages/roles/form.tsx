import { PERMISSIONS } from 'shared/src/schemas'
import type { Permission } from 'shared/src/types'
import { createSignal, For, type JSX } from 'solid-js'
import { create_role, fetch_role, type RoleJson, update_role } from '../../api/roles'
import { DescriptionField, FormPage, NameField } from '../../components/form'
import { type MessageKey, t } from '../../i18n'
import { objectAccessLabel, permissionLabel } from '../../i18n/labels'
import { type FormValues, submit_entity_form, text, useEntityForm } from '../../lib/form'
import {
	INTEGRATION_ACCESS_LEVELS,
	INTEGRATION_PERMISSIONS,
	type IntegrationAccess,
	integrationAccess,
	integrationPermissions,
	OBJECT_ACCESS_LEVELS,
	OBJECT_PERMISSIONS,
	type ObjectAccess,
	objectAccess,
	objectPermissions,
} from './object_access'

/** Permissions covered by an access level control instead of a checkbox. */
const LEVEL_PERMISSIONS: readonly Permission[] = [...OBJECT_PERMISSIONS, ...INTEGRATION_PERMISSIONS]

/** Permissions with their own checkbox. */
type CheckboxPermission = Exclude<
	Permission,
	'view' | 'edit' | 'delete' | 'integrations.write' | 'integrations.manage'
>

type PermissionGroupKey = 'admin' | 'logs' | 'contacts' | 'features'

/** Checkbox group of each remaining permission (a new permission must pick one). */
const CHECKBOX_GROUP: Record<CheckboxPermission, PermissionGroupKey> = {
	'users.manage': 'admin',
	'settings.manage': 'admin',
	'billing.manage': 'admin',
	'changelog.view': 'logs',
	'audit_log.view': 'logs',
	'employees.tenants': 'contacts',
	'contacts.directory': 'contacts',
	'tickets.create': 'features',
	'ai.use': 'features',
}

/** Group titles in display order: everyday data first, admin areas last. */
const GROUP_TITLES: Record<PermissionGroupKey, MessageKey> = {
	contacts: 'role.groupContacts',
	features: 'role.groupFeatures',
	logs: 'role.groupLogs',
	admin: 'role.groupAdmin',
}

interface CheckboxGroup {
	key: PermissionGroupKey
	permissions: Permission[]
}

/** Checkbox groups in display order, each listing its permissions by label. */
function checkboxGroups(): CheckboxGroup[] {
	return (Object.keys(GROUP_TITLES) as PermissionGroupKey[]).map((key) => ({
		key,
		permissions: PERMISSIONS.filter(
			(p) =>
				!LEVEL_PERMISSIONS.includes(p) && CHECKBOX_GROUP[p as CheckboxPermission] === key,
		).sort((x, y) => permissionLabel(x).localeCompare(permissionLabel(y))),
	}))
}

/** Segments of the object access control, weakest first. */
const ACCESS_CHOICES: readonly ObjectAccess[] = ['', ...OBJECT_ACCESS_LEVELS]

/** Segments of the integration access control, weakest first. */
const INTEGRATION_CHOICES: readonly IntegrationAccess[] = ['', ...INTEGRATION_ACCESS_LEVELS]

/** Segmented radio group choosing one cumulative access level ('' = no access). */
function AccessLevelGroup<L extends string>(props: {
	id: string
	title: string
	choices: readonly L[]
	value: L
	onChange: (level: L) => void
}): JSX.Element {
	return (
		<div class="permission-group" role="radiogroup" aria-labelledby={`${props.id}-label`}>
			<span class="permission-group-title" id={`${props.id}-label`}>
				{props.title}
			</span>
			<div class="segmented">
				<For each={props.choices}>
					{(level: L): JSX.Element => (
						<label class="segmented-option">
							<input
								type="radio"
								name={props.id}
								value={level}
								checked={props.value === level}
								onChange={() => props.onChange(level)}
							/>
							<span>
								{level === '' ? t('role.noObjectAccess') : objectAccessLabel(level)}
							</span>
						</label>
					)}
				</For>
			</div>
		</div>
	)
}

/**
 * Role create (`id` omitted) or edit form: name, description, the object
 * access level (view/edit/delete as one cumulative choice), the integration
 * access level (write/manage) and checkboxes for the remaining permissions.
 */
function RoleForm(props: { id?: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [access, setAccess] = createSignal<ObjectAccess>('')
	const [integrations, setIntegrations] = createSignal<IntegrationAccess>('')
	const [permissions, setPermissions] = createSignal<ReadonlySet<Permission>>(new Set())
	const form = useEntityForm({
		id: props.id,
		load: fetch_role,
		fill: (row: RoleJson) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setAccess(objectAccess(row.permissions))
			setIntegrations(integrationAccess(row.permissions))
			setPermissions(new Set(row.permissions.filter((p) => !LEVEL_PERMISSIONS.includes(p))))
		},
	})
	const prefix = form.editing ? 'role-edit' : 'role'

	function toggle(permission: Permission, checked: boolean): void {
		const next = new Set(permissions())
		if (checked) {
			next.add(permission)
		} else {
			next.delete(permission)
		}
		setPermissions(next)
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		const levels = [...objectPermissions(access()), ...integrationPermissions(integrations())]
		const granted = PERMISSIONS.filter((p) => levels.includes(p) || permissions().has(p))
		await submit_entity_form(e, {
			form,
			name: name(),
			body: (values: FormValues) => ({
				name: values.name,
				description: text(description()),
				permissions: granted,
			}),
			create: create_role,
			update: update_role,
			navigateTo: '/roles',
			reset: () => {
				setName('')
				setDescription('')
				setAccess('')
				setIntegrations('')
				setPermissions(new Set<Permission>())
			},
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('role.editTitle') : t('role.addTitle')}
			name={form.record()?.name}
			loadingText={t('role.loadingOne')}
			cancelTo="/roles"
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('role.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus
			/>
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>
			<fieldset class="field-fieldset">
				<legend class="visually-hidden">{t('role.permissions')}</legend>
				<div class="field">
					<span class="field-group-label" aria-hidden="true">
						{t('role.permissions')}
					</span>
					<div class="field-control permission-groups">
						<AccessLevelGroup
							id={`${prefix}-object-access`}
							title={t('role.objectAccess')}
							choices={ACCESS_CHOICES}
							value={access()}
							onChange={setAccess}
						/>
						<AccessLevelGroup
							id={`${prefix}-integration-access`}
							title={t('role.integrationAccess')}
							choices={INTEGRATION_CHOICES}
							value={integrations()}
							onChange={setIntegrations}
						/>
						<For each={checkboxGroups()}>
							{(group: CheckboxGroup): JSX.Element => (
								<div class="permission-group">
									<span class="permission-group-title" aria-hidden="true">
										{t(GROUP_TITLES[group.key])}
									</span>
									<div class="permission-group-items">
										<For each={group.permissions}>
											{(permission: Permission): JSX.Element => (
												<label class="field-checkbox-label">
													<input
														type="checkbox"
														checked={permissions().has(permission)}
														onChange={(
															e: Event & {
																currentTarget: HTMLInputElement
															},
														) =>
															toggle(
																permission,
																e.currentTarget.checked,
															)
														}
													/>
													{permissionLabel(permission)}
												</label>
											)}
										</For>
									</div>
								</div>
							)}
						</For>
					</div>
				</div>
			</fieldset>
		</FormPage>
	)
}

/** /roles/add — role create form. */
export function RoleAddPage(): JSX.Element {
	return <RoleForm />
}

/** /roles/:id/edit — role edit form. */
export function RoleEditPage(props: { id: number }): JSX.Element {
	return <RoleForm id={props.id} />
}
