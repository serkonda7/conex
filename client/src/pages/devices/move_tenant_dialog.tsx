import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import { type DeviceListItem, update_device } from '../../api/devices'
import { fetch_tenants } from '../../api/tenancy'
import { update_virtual_machine } from '../../api/virtual_machines'
import { InlineError } from '../../components/feedback'
import { Hint, row_options, SelectField } from '../../components/form'
import { Modal } from '../../components/modal'
import { t, tp } from '../../i18n'
import { createRows, useAction } from '../../lib/resource'
import { parseId } from '../../lib/router'

export interface MoveTenantDialogProps {
	/** A device, or a hostless VM (a hosted VM follows its host). */
	row: DeviceListItem
	on_moved: () => void
	on_close: () => void
}

/**
 * Moves a device or hostless VM to another tenant. Sites, locations and
 * racks belong to a tenant, so a device's placement is cleared with the
 * move; a VM loses its employee assignment. A device's VMs follow it
 * (server side).
 */
export function MoveTenantDialog(props: MoveTenantDialogProps): JSX.Element {
	const [tenantId, setTenantId] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [tenants] = createRows(fetch_tenants, setError)
	const save = useAction(setError)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const target = parseId(tenantId())
		if (target === null) {
			return
		}
		const row = props.row
		const moved = await save.run(() =>
			row.kind === 'vm'
				? update_virtual_machine(row.id, { tenant_id: target, employee_id: null })
				: update_device(row.id, {
						tenant_id: target,
						site_id: null,
						location_id: null,
						rack_id: null,
						shelf_id: null,
						face: null,
						position_u: null,
					}),
		)
		if (moved) {
			props.on_moved()
		}
	}

	return (
		<Modal
			title={t(props.row.kind === 'vm' ? 'vm.moveTenantTitle' : 'device.moveTenantTitle', {
				name: props.row.name,
			})}
			on_close={props.on_close}
		>
			<form class="form-stacked" onSubmit={handleSave}>
				<SelectField
					id="move-device-tenant"
					label={tp('entity.tenant', 1)}
					required
					value={tenantId()}
					onChange={setTenantId}
					options={row_options(
						(tenants() ?? []).filter((row) => row.id !== props.row.tenant_id),
					)}
					emptyLabel={t('common.selectPlaceholder')}
					hint={
						<Hint>
							{t(
								props.row.kind === 'vm'
									? 'vm.moveTenantHint'
									: 'device.moveTenantHint',
							)}
						</Hint>
					}
				/>
				<div class="modal-actions">
					<button type="submit" disabled={tenantId() === '' || save.pending()}>
						{t('device.moveTenant')}
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
