/**
 * Rack-type select options shared by the rack forms: the model as label with
 * its manufacturer as detail column.
 */
import { fetch_manufacturers, fetch_rack_types } from '../../api/templates'
import type { FormOption } from '../../components/form'
import { useNameOf } from '../../lib/lookup'
import { createRows, type ErrorSink } from '../../lib/resource'

export function useRackTypeOptions(onError?: ErrorSink): {
	options: () => FormOption[]
	/** Refetches the types and their manufacturers (`SelectField.reload`). */
	reload: () => Promise<void>
} {
	const [types, { refetch: refetchTypes }] = createRows(fetch_rack_types, onError)
	const [manufacturers, { refetch: refetchManufacturers }] = createRows(
		fetch_manufacturers,
		onError,
	)
	const manufacturerName = useNameOf(manufacturers)
	return {
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
