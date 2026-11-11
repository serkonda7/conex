/**
 * Rack-type select options shared by the rack forms: the model as label with
 * its manufacturer as detail column.
 */
import type { RackTypeListRow } from 'server/src/db/rack_types'
import { fetch_rack_types } from '../../api/templates'
import type { ErrorSink } from '../../lib/resource'
import { type TypeOptions, useTypeOptions } from '../device_types/options'

export function useRackTypeOptions(onError?: ErrorSink): TypeOptions<RackTypeListRow> {
	return useTypeOptions(fetch_rack_types, onError)
}
