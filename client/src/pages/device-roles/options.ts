/**
 * Device-role select options shared by the device and VM forms: the full
 * `parent > child` path as label, so nested roles stay distinguishable.
 */
import type { DeviceRoleListRow } from '../../api/device_roles'
import type { FormOption } from '../../components/form'
import { treeIcons, treePaths } from '../../components/tree_name'
import { deviceRoleIcon } from '../../lib/icons'

export function deviceRoleOptions(roles: readonly DeviceRoleListRow[]): FormOption[] {
	const paths = treePaths(roles)
	const icons = treeIcons(roles)
	return roles.map((role) => ({
		value: role.id,
		label: paths.get(role.id) ?? role.name,
		icon: deviceRoleIcon(icons.get(role.id)),
	}))
}
