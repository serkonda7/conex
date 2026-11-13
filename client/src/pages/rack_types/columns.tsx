/**
 * Rack-type table columns shared by the rack-type list and the manufacturer
 * detail page; each page composes them in its own order.
 */
import type { JSX } from 'solid-js'
import type { RackTypeListRow } from '../../api/templates'
import type { DataTableColumn } from '../../components/data_table'
import { t, tp } from '../../i18n'
import { formFactorLabel } from '../../i18n/labels'

interface ColumnOpts {
	sortable?: boolean
}

/** Model, linking the rack type. */
export function rackTypeModelColumn(opts?: ColumnOpts): DataTableColumn<RackTypeListRow> {
	return {
		key: 'model',
		label: t('common.model'),
		sortable: opts?.sortable,
		getValue: (rt: RackTypeListRow): JSX.Element => (
			<a href={`/rack-types/${rt.id}`}>{rt.model}</a>
		),
	}
}

/** Form factor label. */
export function rackTypeFormFactorColumn(opts?: ColumnOpts): DataTableColumn<RackTypeListRow> {
	return {
		key: 'form_factor',
		label: t('rackType.formFactor'),
		sortable: opts?.sortable,
		getValue: (rt: RackTypeListRow): string => formFactorLabel(rt.form_factor),
	}
}

/** Height in rack units. */
export function rackTypeHeightColumn(opts?: ColumnOpts): DataTableColumn<RackTypeListRow> {
	return {
		key: 'u_height',
		label: t('common.heightU'),
		sortable: opts?.sortable,
		getValue: (rt: RackTypeListRow): string => `${rt.u_height}`,
	}
}

/** Number of racks of the type, linking the filtered rack list. */
export function rackTypeRacksColumn(opts?: ColumnOpts): DataTableColumn<RackTypeListRow> {
	return {
		key: 'racks',
		label: tp('entity.rack', 2),
		sortable: opts?.sortable,
		getValue: (rt: RackTypeListRow): JSX.Element => (
			<a href={`/racks?rack_type=${rt.id}`}>{rt.instance_count}</a>
		),
	}
}
