import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import { type DeviceRow, update_device } from '../../api/devices'
import { fetch_tenants } from '../../api/tenancy'
import { InlineError } from '../../components/feedback'
import { Hint, row_options, SelectField } from '../../components/form'
import { Modal } from '../../components/modal'
import { t, tp } from '../../i18n'
import { createRows, useAction } from '../../lib/resource'
import { parseId } from '../../lib/router'

export interface MoveTenantDialogProps {
	device: DeviceRow
	on_moved: () => void
	on_close: () => void
}

/**
 * Moves a device to another tenant. Sites, locations and racks belong to a
 * tenant, so the device's placement is cleared with the move.
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
		const moved = await save.run(() =>
			update_device(props.device.id, {
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
			title={t('device.moveTenantTitle', { name: props.device.name })}
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
						(tenants() ?? []).filter((row) => row.id !== props.device.tenant_id),
					)}
					emptyLabel={t('common.selectPlaceholder')}
					hint={<Hint>{t('device.moveTenantHint')}</Hint>}
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
