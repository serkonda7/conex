import type { JSX } from 'solid-js'
import { deviceStatusLabel } from '../../i18n/labels'

/** Preserve other lifecycle statuses unless the inactive checkbox changes. */
export function inactiveStatusChange(
	inactive: boolean,
	original: string,
): 'active' | 'inactive' | undefined {
	if (inactive === (original === 'inactive')) {
		return undefined
	}
	return inactive ? 'inactive' : 'active'
}

/** Localized lifecycle status of a device or virtual machine. */
export function DeviceStatusBadge(props: { status: string }): JSX.Element {
	return <span class={`badge badge-${props.status}`}>{deviceStatusLabel(props.status)}</span>
}
