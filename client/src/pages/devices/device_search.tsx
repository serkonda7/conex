import { Result } from 'better-result'
import { type DeviceRow, fetch_devices } from '../../api/devices'
import { fetch_device_types } from '../../api/templates'
import type { ObjectSearchProps } from '../../components/object_selector'
import { t } from '../../i18n'
import { useNameOf } from '../../lib/lookup'
import { createRows } from '../../lib/resource'

type DeviceSearchProps = Pick<
	ObjectSearchProps<DeviceRow>,
	'placeholder' | 'load' | 'get_label' | 'get_detail' | 'get_note'
>

/**
 * Device picker props for `ObjectSearch` / `ObjectSelector`: results show
 * the device type next to the name and an optional caller-specific `extra`
 * line below (e.g. existing cables or the current rack placement).
 */
export function useDeviceSearch(
	extra?: (device: DeviceRow) => string | undefined,
): DeviceSearchProps {
	const [types] = createRows(fetch_device_types)
	const typeName = useNameOf(types, (type) => type.model)
	return {
		placeholder: t('rack.searchDevices'),
		load: async (search: string) => {
			const res = await fetch_devices({ search })
			return Result.isError(res) ? Result.err(res.error) : Result.ok(res.value.items)
		},
		get_label: (device: DeviceRow) => device.name,
		get_detail: (device: DeviceRow) => typeName(device.device_type_id),
		get_note: extra,
	}
}
