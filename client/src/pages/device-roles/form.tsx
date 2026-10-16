import type { DeviceRoleIcon } from 'shared/src/schemas'
import { createMemo, createSignal, type JSX } from 'solid-js'
import {
	create_device_role,
	type DeviceRoleRow,
	fetch_device_role,
	fetch_device_roles,
	update_device_role,
} from '../../api/device_roles'
import {
	CheckboxField,
	DescriptionField,
	FormPage,
	NameField,
	SelectField,
} from '../../components/form'
import { treeIcons, treePaths } from '../../components/tree_name'
import { t } from '../../i18n'
import { deviceRoleIconOptions } from '../../i18n/labels'
import {
	type FormValues,
	id_value,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { deviceRoleIcon } from '../../lib/icons'
import { createRows } from '../../lib/resource'
import { parseId, queryParam, useFormReturnRoute } from '../../lib/router'

/** Device role create (`id` omitted) or edit form. */
function DeviceRoleForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [parentId, setParentId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [icon, setIcon] = createSignal('')
	const [canHostVms, setCanHostVms] = createSignal(false)
	const form = useEntityForm({
		id: props.id,
		load: fetch_device_role,
		fill: (row: DeviceRoleRow) => {
			setName(row.name)
			setParentId(id_value(row.parent_id))
			setDescription(row.description ?? '')
			setIcon(row.icon ?? '')
			setCanHostVms(row.can_host_vms === 1)
		},
	})
	const prefix = form.editing ? 'device-role-edit' : 'device-role'
	const backTo = useFormReturnRoute('/device-roles', props.id)
	const [roles] = createRows(fetch_device_roles, form.setError)
	// A role cannot move under itself or one of its descendants.
	const parentOptions = createMemo(() => {
		const all = roles() ?? []
		const excluded = new Set<number>(props.id === undefined ? [] : [props.id])
		let grew = true
		while (grew) {
			grew = false
			for (const role of all) {
				if (
					role.parent_id !== null &&
					excluded.has(role.parent_id) &&
					!excluded.has(role.id)
				) {
					excluded.add(role.id)
					grew = true
				}
			}
		}
		const paths = treePaths(all)
		const icons = treeIcons(all)
		return all
			.filter((role) => !excluded.has(role.id))
			.map((role) => ({
				value: role.id,
				label: paths.get(role.id) ?? role.name,
				icon: deviceRoleIcon(icons.get(role.id)),
			}))
	})

	const selectedIcon = (): DeviceRoleIcon | null =>
		icon() === '' ? null : (icon() as DeviceRoleIcon)

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		await submit_form({
			form,
			name: name(),
			save: ({ name: trimmed }: FormValues) =>
				id === undefined
					? create_device_role({
							name: trimmed,
							parent_id: parseId(parentId()),
							description: text(description()),
							icon: selectedIcon(),
							can_host_vms: canHostVms(),
						})
					: update_device_role(id, {
							name: trimmed,
							parent_id: parseId(parentId()),
							description: text(description()) ?? null,
							icon: selectedIcon(),
							can_host_vms: canHostVms(),
						}),
			navigateTo: backTo(),
			onSuccess: is_add_another_submit(e)
				? (): void => {
						setName('')
						setDescription('')
						setIcon('')
						setCanHostVms(false)
					}
				: undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('deviceRole.editTitle') : t('deviceRole.addTitle')}
			name={form.record()?.name}
			loadingText={t('deviceRole.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('deviceRole.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus={!form.editing}
				disabled={form.record()?.key != null}
			/>
			<SelectField
				id={`${prefix}-parent`}
				label={t('deviceRole.parent')}
				value={parentId()}
				onChange={setParentId}
				options={parentOptions()}
				emptyLabel={t('deviceRole.topLevel')}
			/>
			<SelectField
				id={`${prefix}-icon`}
				label={t('deviceRole.icon')}
				value={icon()}
				onChange={setIcon}
				options={deviceRoleIconOptions()}
				emptyLabel={t('deviceRole.noIcon')}
			/>
			<CheckboxField
				id={`${prefix}-can-host-vms`}
				label={t('deviceRole.canHostVms')}
				checked={canHostVms()}
				onChange={setCanHostVms}
			/>
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>
		</FormPage>
	)
}

/** /device-roles/add — device role create form. */
export function DeviceRoleAddPage(): JSX.Element {
	return <DeviceRoleForm />
}

/** /device-roles/:id/edit — device role edit form. Saves back to the list when opened from it. */
export function DeviceRoleEditPage(props: { id: number }): JSX.Element {
	return <DeviceRoleForm id={props.id} />
}
