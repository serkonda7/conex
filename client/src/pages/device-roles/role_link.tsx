import type { JSX } from 'solid-js'
import type { DeviceRoleListRow } from '../../api/device_roles'
import { IconLabel } from '../../components/icon_label'
import { deviceRoleLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'

/**
 * Table cell linking a device role by id, with its icon and label looked up
 * in the loaded `roles`.
 */
export function useDeviceRoleLink(
	roles: () => readonly DeviceRoleListRow[] | undefined,
): (roleId: number) => JSX.Element {
	const roleName = useNameOf(roles, deviceRoleLabel)
	const roleIcon = (roleId: number): ReturnType<typeof deviceRoleIcon> =>
		deviceRoleIcon(roles()?.find((r) => r.id === roleId)?.icon)
	return (roleId: number): JSX.Element => (
		<a href={`/device-roles/${roleId}`}>
			<IconLabel icon={roleIcon(roleId)}>{roleName(roleId)}</IconLabel>
		</a>
	)
}
