import type { RackRow } from '../../api/racks'
import type { DataTableColumn } from '../../components/data_table'
import { t } from '../../i18n'

/** Rack height in units, for the related-rack tables of detail pages. */
export function rackHeightColumn(): DataTableColumn<RackRow> {
	return {
		key: 'height',
		label: t('common.height'),
		getValue: (r: RackRow): string => t('common.heightUnits', { count: r.height_u }),
	}
}
