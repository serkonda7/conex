import type { DeviceListItem } from '../../api/devices'

/** Detail route of a device or virtual machine list row. */
export function deviceListHref(row: DeviceListItem): string {
	return row.kind === 'vm' ? `/devices/vm/${row.id}` : `/devices/${row.id}`
}
