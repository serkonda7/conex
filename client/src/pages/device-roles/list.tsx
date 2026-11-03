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

const COLLAPSED_KEY = 'conex:collapsed:device-roles'

/** Collapsed role ids kept in `localStorage`; ids of deleted roles are harmless. */
function loadCollapsed(): number[] {
	try {
		const raw: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]')
		return Array.isArray(raw) ? raw.filter((id): id is number => Number.isInteger(id)) : []
	} catch {
		return []
	}
}

function saveCollapsed(ids: readonly number[]): void {
	try {
		window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids))
	} catch {
		// Storage unavailable: the collapse still applies until the page closes.
	}
}

/**
 * /device-roles — device role list: search, sortable columns, nested roles
 * indented under their parent and collapsible, and icon actions with delete
 * in a row menu.
 */
export function DeviceRolesPage(): JSX.Element {
	const [filterCanHostVms, setFilterCanHostVms] = createSignal<string[]>([])
	const [filterBundle, setFilterBundle] = createSignal<string[]>([])
	const [collapsed, setCollapsed] = createSignal<number[]>(loadCollapsed())
	function toggleCollapsed(id: number): void {
		const next = collapsed().includes(id)
			? collapsed().filter((c) => c !== id)
			: [...collapsed(), id]
		setCollapsed(next)
		saveCollapsed(next)
	}
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
	// Collapsing hides rows of the current page only, so it keeps the page.
	const isCollapsed = (id: number): boolean => collapsed().includes(id)
	const shown = (): DeviceRoleListRow[] =>
		list.rows().filter((r) => !r.ancestor_ids.some(isCollapsed))
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
			list={{ ...list, rows: shown }}
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
						<TreeName
							depth={r.depth}
							toggle={{
								hasChildren: r.child_count > 0,
								collapsed: isCollapsed(r.id),
								label: t(isCollapsed(r.id) ? 'tree.expand' : 'tree.collapse', {
									name: deviceRoleLabel(r),
								}),
								onToggle: (): void => toggleCollapsed(r.id),
							}}
						>
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
