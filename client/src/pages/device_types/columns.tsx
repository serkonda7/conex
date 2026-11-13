/**
 * Device-type table columns shared by the device-type list and the device
 * role and manufacturer detail pages; each page composes them in its own order.
 */
import { type JSX, Show } from 'solid-js'
import type { DeviceTypeListRow } from '../../api/templates'
import type { DataTableColumn } from '../../components/data_table'
import { t, tp } from '../../i18n'

interface ColumnOpts {
	sortable?: boolean
}

/** Model, linking the device type. */
export function deviceTypeModelColumn(opts?: ColumnOpts): DataTableColumn<DeviceTypeListRow> {
	return {
		key: 'model',
		label: t('common.model'),
		sortable: opts?.sortable,
		getValue: (dt: DeviceTypeListRow): JSX.Element => (
			<a href={`/device-types/${dt.id}`}>{dt.model}</a>
		),
	}
}

/** Manufacturer, linked by the looked-up name. */
export function deviceTypeManufacturerColumn(
	manufacturerName: (id: number) => string,
	opts?: ColumnOpts,
): DataTableColumn<DeviceTypeListRow> {
	return {
		key: 'manufacturer',
		label: tp('entity.manufacturer', 1),
		sortable: opts?.sortable,
		getValue: (dt: DeviceTypeListRow): JSX.Element => (
			<a href={`/manufacturers/${dt.manufacturer_id}`}>
				{manufacturerName(dt.manufacturer_id)}
			</a>
		),
	}
}

/** Part number, `—` when empty. */
export function deviceTypePartNumberColumn(opts?: ColumnOpts): DataTableColumn<DeviceTypeListRow> {
	return {
		key: 'part_number',
		label: t('deviceType.partNumber'),
		sortable: opts?.sortable,
		getValue: (dt: DeviceTypeListRow): string => dt.part_number || '—',
	}
}

/** Default device role through `roleCell`, `—` without one. */
export function deviceTypeRoleColumn(
	roleCell: (roleId: number) => JSX.Element,
): DataTableColumn<DeviceTypeListRow> {
	return {
		key: 'role',
		label: t('deviceType.defaultRole'),
		getValue: (dt: DeviceTypeListRow): JSX.Element => (
			<Show when={dt.default_device_role_id} fallback="—">
				{(roleId: () => number): JSX.Element => roleCell(roleId())}
			</Show>
		),
	}
}

/** Height in rack units. */
export function deviceTypeHeightColumn(opts?: ColumnOpts): DataTableColumn<DeviceTypeListRow> {
	return {
		key: 'u_height',
		label: t('common.heightU'),
		sortable: opts?.sortable,
		getValue: (dt: DeviceTypeListRow): string => `${dt.u_height}`,
	}
}

/** Number of devices of the type, linking the filtered device list. */
export function deviceTypeDevicesColumn(opts?: ColumnOpts): DataTableColumn<DeviceTypeListRow> {
	return {
		key: 'devices',
		label: tp('entity.device', 2),
		sortable: opts?.sortable,
		getValue: (dt: DeviceTypeListRow): JSX.Element => (
			<a href={`/devices?device_type=${dt.id}`}>{dt.instance_count}</a>
		),
	}
}
