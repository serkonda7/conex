/**
 * Device-type select options shared by the device and rack forms: the
 * model as label with its manufacturer as detail column.
 */
import type { DeviceTypeListQuery } from 'shared/src/types'
import {
	type DeviceTypeListRow,
	fetch_device_types,
	fetch_manufacturers,
} from '../../api/templates'
import type { FormOption } from '../../components/form'
import { useNameOf } from '../../lib/lookup'
import { createRows, type ErrorSink, type QueryResource } from '../../lib/resource'

export function useDeviceTypeOptions(
	filters: Partial<DeviceTypeListQuery>,
	onError?: ErrorSink,
): {
	types: QueryResource<DeviceTypeListRow[]>
	options: () => FormOption[]
	/** Refetches the types and their manufacturers (`SelectField.reload`). */
	reload: () => Promise<void>
} {
	const [types, { refetch: refetchTypes }] = createRows(
		() => fetch_device_types(filters),
		onError,
	)
	const [manufacturers, { refetch: refetchManufacturers }] = createRows(
		fetch_manufacturers,
		onError,
	)
	const manufacturerName = useNameOf(manufacturers)
	return {
		types,
		options: () =>
			(types() ?? []).map((type) => ({
				value: type.id,
				label: type.model,
				detail: manufacturerName(type.manufacturer_id),
			})),
		reload: async (): Promise<void> => {
			await Promise.all([refetchTypes(), refetchManufacturers()])
		},
	}
}
