import type { JSX } from 'solid-js'
import { createEffect, createSignal, on } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import {
	type IntegrationProvider,
	import_external_device,
	type LinkBoardExternal,
} from '../../api/integrations'
import { InlineError } from '../../components/feedback'
import { Hint, NameField, SelectField } from '../../components/form'
import { Modal } from '../../components/modal'
import { t, tp } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { id_value } from '../../lib/form'
import { createRows, useAction } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { useDeviceTypeOptions } from '../device_types/options'
import { deviceRoleOptions } from '../device-roles/options'

export interface ImportDeviceDialogProps {
	provider: IntegrationProvider
	tenant_id: number
	row: LinkBoardExternal
	on_imported: () => void
	on_close: () => void
}

/**
 * Creates a conex device of the tenant from an external device and links the
 * two. External devices carry no conex device type or role, so both are
 * picked here: the type is preselected when one matches the external model,
 * the role follows the type's default. Serial, asset tag and status come
 * from the external device (server side).
 */
export function ImportDeviceDialog(props: ImportDeviceDialogProps): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [name, setName] = createSignal(props.row.name.slice(0, 100))
	const [typeId, setTypeId] = createSignal(id_value(props.row.device_type_id))
	const [roleId, setRoleId] = createSignal('')
	const { types, options: typeOptions, reload: reloadTypes } = useDeviceTypeOptions({}, setError)
	const [roles, { refetch: refetchRoles }] = createRows(fetch_device_roles, setError)
	const save = useAction(setError)

	const defaultRoleOf = (id: string): string =>
		id_value((types() ?? []).find((type) => type.id === parseId(id))?.default_device_role_id)

	// The preselected type's default role, once the types have loaded.
	createEffect(
		on(types, () => {
			if (roleId() === '') {
				setRoleId(defaultRoleOf(typeId()))
			}
		}),
	)

	function handleTypeChange(value: string): void {
		const previous = defaultRoleOf(typeId())
		setTypeId(value)
		const next = defaultRoleOf(value)
		if (next && (!roleId() || roleId() === previous)) {
			setRoleId(next)
		}
	}

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const deviceTypeId = parseId(typeId())
		const deviceRoleId = parseId(roleId())
		if (deviceTypeId === null || deviceRoleId === null || name().trim() === '') {
			return
		}
		const imported = await save.run(() =>
			import_external_device(props.provider, {
				tenant_id: props.tenant_id,
				external_id: props.row.external_id,
				name: name().trim(),
				device_type_id: deviceTypeId,
				device_role_id: deviceRoleId,
			}),
		)
		if (imported) {
			props.on_imported()
		}
	}

	const source = (): string =>
		[props.row.detail, props.row.serial].filter((v) => v !== null && v !== '').join(' · ')

	return (
		<Modal
			title={t('integration.importDeviceTitle', { name: props.row.name })}
			on_close={props.on_close}
		>
			<form class="form-stacked" onSubmit={handleSave}>
				<NameField id="import-device-name" value={name()} onInput={setName} />
				<SelectField
					id="import-device-type"
					label={tp('entity.deviceType', 1)}
					required
					autofocus
					value={typeId()}
					onChange={handleTypeChange}
					options={typeOptions()}
					emptyLabel={t('common.selectPlaceholder')}
					add={{ label: tp('entity.deviceType', 1), href: '/device-types/import' }}
					reload={reloadTypes}
					hint={
						source() === '' ? undefined : (
							<Hint>
								{t('integration.importDeviceSource', {
									provider: providerLabel(props.provider),
									source: source(),
								})}
							</Hint>
						)
					}
				/>
				<SelectField
					id="import-device-role"
					label={tp('entity.deviceRole', 1)}
					required
					value={roleId()}
					onChange={setRoleId}
					options={deviceRoleOptions(roles() ?? [])}
					emptyLabel={t('common.selectPlaceholder')}
					add={{ label: tp('entity.deviceRole', 1), href: '/device-roles/add' }}
					reload={refetchRoles}
				/>
				<div class="modal-actions">
					<button
						type="submit"
						disabled={
							typeId() === '' ||
							roleId() === '' ||
							name().trim() === '' ||
							save.pending()
						}
					>
						{t('integration.importToConex')}
					</button>
					<button type="button" onClick={props.on_close}>
						{t('common.cancel')}
					</button>
				</div>
			</form>
			<InlineError message={error()} alert />
		</Modal>
	)
}
