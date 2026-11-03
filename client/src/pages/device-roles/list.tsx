import { IconCheck } from '@tabler/icons-solidjs'
import { createSignal, type JSX, Show } from 'solid-js'
import {
	type DeviceRoleListRow,
	type DeviceRoleSort,
	delete_device_role,
	fetch_device_roles,
} from '../../api/device_roles'
import { fetch_managed_bundles } from '../../api/service_catalog'
import { descriptionColumn } from '../../components/data_table'
import { IconLabel } from '../../components/icon_label'
import { EntityListPage, idOptions, idsOf, useEntityList } from '../../components/list_page'
import { TreeName } from '../../components/tree_name'
import { t, tp } from '../../i18n'
import { deviceRoleLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { createRows } from '../../lib/resource'

/**
 * /device-roles — device role list: search, sortable columns, nested roles
 * indented under their parent, and icon actions with delete in a row menu.
 */
export function DeviceRolesPage(): JSX.Element {
	const [filterCanHostVms, setFilterCanHostVms] = createSignal<string[]>([])
	const [filterBundle, setFilterBundle] = createSignal<string[]>([])
	const list = useEntityList({
		noun: 'noun.deviceRole',
		sort: 'name' as DeviceRoleSort,
		filters: () => ({
			// Both values chosen is the same as no filter.
			can_host_vms:
				filterCanHostVms().length === 1 ? filterCanHostVms()[0] === 'true' : undefined,
			bundle: idsOf(filterBundle()),
		}),
		fetch: fetch_device_roles,
		remove: delete_device_role,
	})
	const [bundles] = createRows(fetch_managed_bundles, list.setError)
	const bundleCell = (r: DeviceRoleListRow): JSX.Element => (
		<Show when={r.managed_bundle} fallback="—">
			{(b: () => NonNullable<DeviceRoleListRow['managed_bundle']>): JSX.Element => (
				<a href={`/managed-bundles/${b().id}`}>
					{b().inherited ? t('deviceRole.inheritedBundle', { name: b().name }) : b().name}
				</a>
			)}
		</Show>
	)

	return (
		<EntityListPage
			list={list}
			title={tp('entity.deviceRole', 2)}
			addHref="/device-roles/add"
			filters={[
				{
					key: 'can_host_vms',
					label: t('deviceRole.canHostVms'),
					options: [
						{ value: 'true', label: t('common.yes') },
						{ value: 'false', label: t('common.no') },
					],
					value: filterCanHostVms,
					onChange: setFilterCanHostVms,
				},
				{
					key: 'bundle',
					label: tp('entity.managedBundle', 1),
					options: idOptions(bundles()),
					value: filterBundle,
					onChange: setFilterBundle,
				},
			]}
			columns={[
				{
					key: 'name',
					label: t('common.name'),
					sortable: true,
					getValue: (r: DeviceRoleListRow): JSX.Element => (
						<TreeName depth={r.depth}>
							<span class="device-role-name">
								<IconLabel icon={deviceRoleIcon(r.icon)}>
									<a href={`/device-roles/${r.id}`}>{deviceRoleLabel(r)}</a>
								</IconLabel>
							</span>
						</TreeName>
					),
				},
				descriptionColumn({ sortable: true }),
				{
					key: 'can_host_vms',
					label: t('deviceRole.canHostVms'),
					getValue: (r: DeviceRoleListRow): JSX.Element => (
						<Show when={r.can_host_vms === 1} fallback="—">
							<IconCheck class="bool-yes" size={18} aria-label={t('common.yes')} />
						</Show>
					),
				},
				{
					key: 'managed_bundle',
					label: tp('entity.managedBundle', 1),
					getValue: bundleCell,
				},
				{
					key: 'devices',
					label: tp('entity.device', 2),
					getValue: (r: DeviceRoleListRow): string => String(r.device_count),
				},
			]}
			columnsKey="device-roles"
			rowName={(r: DeviceRoleListRow): string => deviceRoleLabel(r)}
			editHref={(r: DeviceRoleListRow): string => `/device-roles/${r.id}/edit`}
			deletable={(r: DeviceRoleListRow): boolean => r.key === null}
			emptyText={t('deviceRole.empty')}
		/>
	)
}
