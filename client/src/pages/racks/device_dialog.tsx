import { Combobox } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../../api/devices'
import { fetch_device_types } from '../../api/templates'
import { InlineError } from '../../components/feedback'
import type { FormOption } from '../../components/form'
import { Modal } from '../../components/modal'
import { t, tp } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows, useAction } from '../../lib/resource'

export interface RackDeviceDialogProps {
	title: string
	/** Rack tenant: only its devices are candidates. */
	tenant_id: number | null | undefined
	/** U mounting: hides 0 U devices, which can only sit on a shelf. */
	mountable: boolean
	/** Where a candidate already sits (e.g. its rack placement), shown as detail. */
	get_note: (device: DeviceRow) => string | undefined
	/** Places the device; the dialog stays open on error. */
	on_select: (device: DeviceRow) => Promise<Result<unknown, Error>>
	on_close: () => void
}

/**
 * Picks an existing device to place at a free U or onto a shelf of the rack:
 * a searchable device dropdown, then Save. Candidates load once (pickers load
 * the first 200 rows) and are searched client-side.
 */
export function RackDeviceDialog(props: RackDeviceDialogProps): JSX.Element {
	const [deviceId, setDeviceId] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)

	const [devices] = createResource(async (): Promise<DeviceRow[]> => {
		const res = await fetch_devices({
			tenant: props.tenant_id ?? undefined,
			mountable: props.mountable ? true : undefined,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [types] = createRows(fetch_device_types, setError)
	const typeName = useNameOf(types, (type) => type.model)
	/** Device type and the current placement, each in its own detail column. */
	const options = createMemo((): FormOption[] =>
		(devices() ?? []).map((device) => ({
			value: device.id,
			label: device.name,
			detail: [typeName(device.device_type_id), props.get_note(device) ?? ''],
		})),
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const device = (devices() ?? []).find((row) => String(row.id) === deviceId())
		if (!device) {
			return
		}
		if (await save.run(() => props.on_select(device))) {
			props.on_close()
		}
	}

	return (
		<Modal title={props.title} class="rack-device-dialog" on_close={props.on_close}>
			<form class="form-stacked" onSubmit={handleSave}>
				<Combobox
					id="rack-place-device"
					ariaLabel={tp('entity.device', 1)}
					required
					autofocus
					value={deviceId()}
					onChange={setDeviceId}
					options={options()}
					placeholder={t('rack.searchDevices')}
					searchLabel={t('common.search')}
					noMatchesLabel={t('common.noMatchingObjects')}
				/>
				<div class="modal-actions">
					<button type="submit" disabled={deviceId() === '' || save.pending()}>
						{t('common.save')}
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
