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

/**
 * Managed bundle of a role as the server resolves it: its own, else the
 * nearest ancestor's (`inherited`); null when no role up the tree sets one.
 */
export function effectiveBundle(
	roles: readonly DeviceRoleListRow[],
	roleId: number,
): { id: number; inherited: boolean } | null {
	const byId = new Map(roles.map((r) => [r.id, r]))
	const seen = new Set<number>()
	let role = byId.get(roleId)
	while (role && !seen.has(role.id)) {
		if (role.managed_bundle_id !== null) {
			return { id: role.managed_bundle_id, inherited: role.id !== roleId }
		}
		seen.add(role.id)
		role = role.parent_id === null ? undefined : byId.get(role.parent_id)
	}
	return null
}
