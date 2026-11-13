/**
 * Device-role select options shared by the device and VM forms: the full
 * `parent > child` path as label, so nested roles stay distinguishable.
 */
import type { DeviceRoleListRow } from '../../api/device_roles'
import type { FormOption } from '../../components/form'
import { treeIcons, treePaths } from '../../components/tree_name'
import { deviceRoleLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'

export function deviceRoleOptions(roles: readonly DeviceRoleListRow[]): FormOption[] {
	const paths = treePaths(roles, deviceRoleLabel)
	const icons = treeIcons(roles)
	return roles.map((role) => ({
		value: role.id,
		label: paths.get(role.id) ?? deviceRoleLabel(role),
		icon: deviceRoleIcon(icons.get(role.id)),
	}))
}
