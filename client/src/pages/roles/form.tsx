import { PERMISSIONS } from 'shared/src/schemas'
import type { Permission } from 'shared/src/types'
import { createSignal, For, type JSX } from 'solid-js'
import { create_role, fetch_role, type RoleJson, update_role } from '../../api/roles'
import { DescriptionField, FormPage, NameField } from '../../components/form'
import { t } from '../../i18n'
import { objectAccessLabel, permissionLabel } from '../../i18n/labels'
import { type FormValues, submit_entity_form, text, useEntityForm } from '../../lib/form'
import {
	OBJECT_ACCESS_LEVELS,
	OBJECT_PERMISSIONS,
	type ObjectAccess,
	objectAccess,
	objectPermissions,
} from './object_access'

/** Permissions with their own checkbox; view/edit/delete go through the object access select. */
const OTHER_PERMISSIONS = PERMISSIONS.filter((p) => !OBJECT_PERMISSIONS.includes(p))

/** Segments of the object access control, weakest first. */
const ACCESS_CHOICES: readonly ObjectAccess[] = ['', ...OBJECT_ACCESS_LEVELS]

/**
 * Role create (`id` omitted) or edit form: name, description, the object
 * access level (view/edit/delete as one cumulative choice) and checkboxes
 * for the remaining permissions.
 */
function RoleForm(props: { id?: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [access, setAccess] = createSignal<ObjectAccess>('')
	const [permissions, setPermissions] = createSignal<ReadonlySet<Permission>>(new Set())
	const form = useEntityForm({
		id: props.id,
		load: fetch_role,
		fill: (row: RoleJson) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setAccess(objectAccess(row.permissions))
			setPermissions(new Set(row.permissions.filter((p) => !OBJECT_PERMISSIONS.includes(p))))
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
		const objects = objectPermissions(access())
		const granted = PERMISSIONS.filter((p) => objects.includes(p) || permissions().has(p))
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
						<div
							class="permission-group"
							role="radiogroup"
							aria-labelledby={`${prefix}-object-access-label`}
						>
							<span
								class="permission-group-title"
								id={`${prefix}-object-access-label`}
							>
								{t('role.objectAccess')}
							</span>
							<div class="segmented">
								<For each={ACCESS_CHOICES}>
									{(level: ObjectAccess): JSX.Element => (
										<label class="segmented-option">
											<input
												type="radio"
												name={`${prefix}-object-access`}
												value={level}
												checked={access() === level}
												onChange={() => setAccess(level)}
											/>
											<span>
												{level === ''
													? t('role.noObjectAccess')
													: objectAccessLabel(level)}
											</span>
										</label>
									)}
								</For>
							</div>
						</div>
						<div class="permission-group">
							<span class="permission-group-title" aria-hidden="true">
								{t('role.otherPermissions')}
							</span>
							<div class="permission-group-items">
								<For each={OTHER_PERMISSIONS}>
									{(permission: Permission): JSX.Element => (
										<label class="field-checkbox-label">
											<input
												type="checkbox"
												checked={permissions().has(permission)}
												onChange={(
													e: Event & { currentTarget: HTMLInputElement },
												) => toggle(permission, e.currentTarget.checked)}
											/>
											{permissionLabel(permission)}
										</label>
									)}
								</For>
							</div>
						</div>
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
