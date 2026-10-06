import type { DeviceRoleIcon } from 'shared/src/schemas'
import { createSignal, type JSX } from 'solid-js'
import {
	create_device_role,
	type DeviceRoleRow,
	fetch_device_role,
	update_device_role,
} from '../../api/device_roles'
import { DescriptionField, FormPage, NameField, SelectField } from '../../components/form'
import { t } from '../../i18n'
import { deviceRoleIconOptions } from '../../i18n/labels'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { queryParam } from '../../lib/router'

/** Device role create (`id` omitted) or edit form. */
function DeviceRoleForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [description, setDescription] = createSignal('')
	const [icon, setIcon] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_device_role,
		fill: (row: DeviceRoleRow) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setIcon(row.icon ?? '')
		},
	})
	const prefix = form.editing ? 'device-role-edit' : 'device-role'
	const detailRoute = props.id === undefined ? '/device-roles' : `/device-roles/${props.id}`

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
							description: text(description()),
							icon: selectedIcon(),
						})
					: update_device_role(id, {
							name: trimmed,
							description: text(description()) ?? null,
							icon: selectedIcon(),
						}),
			navigateTo: detailRoute,
			onSuccess: is_add_another_submit(e)
				? (): void => {
						setName('')
						setDescription('')
						setIcon('')
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
			cancelTo={detailRoute}
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
				id={`${prefix}-icon`}
				label={t('deviceRole.icon')}
				value={icon()}
				onChange={setIcon}
				options={deviceRoleIconOptions()}
				emptyLabel={t('deviceRole.noIcon')}
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

/** /device-roles/:id/edit — device role edit form. Saves back to the detail page. */
export function DeviceRoleEditPage(props: { id: number }): JSX.Element {
	return <DeviceRoleForm id={props.id} />
}
