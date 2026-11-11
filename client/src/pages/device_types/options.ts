/**
 * Device- and rack-type select options shared by the device and rack forms:
 * the model as label with its manufacturer as detail column.
 */
import type { Result } from 'better-result'
import type { DeviceTypeListQuery } from 'shared/src/types'
import {
	type DeviceTypeListRow,
	fetch_device_types,
	fetch_manufacturers,
} from '../../api/templates'
import type { FormOption } from '../../components/form'
import { useNameOf } from '../../lib/lookup'
import { createRows, type ErrorSink, type QueryResource } from '../../lib/resource'

export interface TypeOptions<T> {
	types: QueryResource<T[]>
	options: () => FormOption[]
	/** Refetches the types and their manufacturers (`SelectField.reload`). */
	reload: () => Promise<void>
}

/** Options of the types `fetchTypes` loads, labelled by model and manufacturer. */
export function useTypeOptions<T extends { id: number; model: string; manufacturer_id: number }>(
	fetchTypes: () => Promise<Result<T[] | { items: T[] }, Error>>,
	onError?: ErrorSink,
): TypeOptions<T> {
	const [types, { refetch: refetchTypes }] = createRows(fetchTypes, onError)
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

export function useDeviceTypeOptions(
	filters: Partial<DeviceTypeListQuery>,
	onError?: ErrorSink,
): TypeOptions<DeviceTypeListRow> {
	return useTypeOptions(() => fetch_device_types(filters), onError)
}
