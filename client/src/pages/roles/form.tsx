import { PERMISSIONS } from 'shared/src/schemas'
import type { Permission } from 'shared/src/types'
import { createSignal, For, type JSX } from 'solid-js'
import { create_role, fetch_role, type RoleJson, update_role } from '../../api/roles'
import { DescriptionField, FormPage, Hint, NameField } from '../../components/form'
import { t } from '../../i18n'
import { permissionLabel } from '../../i18n/labels'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'

/** Role create (`id` omitted) or edit form: name, description and permission checkboxes. */
function RoleForm(props: { id?: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [permissions, setPermissions] = createSignal<ReadonlySet<Permission>>(new Set())
	const form = useEntityForm({
		id: props.id,
		load: fetch_role,
		fill: (row: RoleJson) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setPermissions(new Set(row.permissions))
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
		e.preventDefault()
		const id = props.id
		const granted = PERMISSIONS.filter((p) => permissions().has(p))
		await submit_form({
			form,
			name: name(),
			save: ({ name: trimmed }: FormValues) =>
				id === undefined
					? create_role({
							name: trimmed,
							description: text(description()),
							permissions: granted,
						})
					: update_role(id, {
							name: trimmed,
							description: text(description()) ?? null,
							permissions: granted,
						}),
			navigateTo: '/roles',
			onSuccess: is_add_another_submit(e)
				? (): void => {
						setName('')
						setDescription('')
						setPermissions(new Set<Permission>())
					}
				: undefined,
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
				autofocus={!form.editing}
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
					<div class="field-control">
						<For each={PERMISSIONS}>
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
