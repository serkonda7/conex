import { IconCheck } from '@tabler/icons-solidjs'
import { createSignal, type JSX, Show } from 'solid-js'
import {
	type DeviceRoleDetail,
	type DeviceRoleListRow,
	delete_device_role,
	fetch_device_role,
	fetch_device_roles,
} from '../../api/device_roles'
import { type DeviceListDevice, type DeviceListItem, fetch_device_list } from '../../api/devices'
import {
	type DeviceTypeListRow,
	fetch_device_types,
	fetch_manufacturers,
} from '../../api/templates'
import { type DataTableColumn, descriptionColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RecordLink,
	RelatedPreview,
	type RelatedTab,
	RelatedTabs,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { ScrollLink } from '../../components/scroll_link'
import { t, tp } from '../../i18n'
import { deviceRoleLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRecord, createRows, createRowsFor } from '../../lib/resource'
import { EolPill } from '../device_types/eol_pill'
import { deviceListHref } from '../devices/list'
import { DeviceStatusBadge } from '../devices/status'

/** Rows of the device type and device tabs; the "View all" link leads to the rest. */
const PREVIEW_LIMIT = 5

/**
 * /device-roles/:id — device role detail: spec sheet (hierarchy, properties,
 * usage) and tabs with its child roles, device types and devices (the
 * latter two including those of child roles).
 */
export function DeviceRoleDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [activeTab, setActiveTab] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [role] = createRecord(id, fetch_device_role, setError)
	const parentId = (): number | null | undefined => role()?.parent_id
	const [parent] = createRecord(parentId, fetch_device_role, setError)
	const [children] = createRowsFor(
		id,
		(key: number) => fetch_device_roles({ parent: key }),
		setError,
	)
	const [deviceTypes] = createRowsFor(
		id,
		(key: number) =>
			fetch_device_types({
				role: [key],
				sort: 'devices',
				order: 'desc',
				limit: PREVIEW_LIMIT,
			}),
		setError,
	)
	const [devices] = createRowsFor(
		id,
		(key: number) => fetch_device_list({ role: [key], limit: PREVIEW_LIMIT }),
		setError,
	)
	const [roles] = createRows(fetch_device_roles, setError)
	const [manufacturers] = createRows(fetch_manufacturers, setError)
	const [allTypes] = createRows(fetch_device_types, setError)
	const roleName = useNameOf(roles, deviceRoleLabel)
	const roleIcon = (roleId: number): ReturnType<typeof deviceRoleIcon> =>
		deviceRoleIcon(roles()?.find((r) => r.id === roleId)?.icon)
	const manufacturerName = useNameOf(manufacturers)
	const typeOf = (typeId: number): DeviceTypeListRow | undefined =>
		allTypes()?.find((type) => type.id === typeId)

	const handleDelete = useDetailDelete({
		noun: 'noun.deviceRole',
		name: () => deviceRoleLabel(role()),
		id: props.id,
		remove: delete_device_role,
		setError,
		listRoute: '/device-roles',
	})

	const roleCell = (roleId: number): JSX.Element => (
		<a href={`/device-roles/${roleId}`}>
			<IconLabel icon={roleIcon(roleId)}>{roleName(roleId)}</IconLabel>
		</a>
	)

	const childColumns: DataTableColumn<DeviceRoleListRow>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (r: DeviceRoleListRow): JSX.Element => (
				<a href={`/device-roles/${r.id}`}>
					<IconLabel icon={deviceRoleIcon(r.icon)}>{deviceRoleLabel(r)}</IconLabel>
				</a>
			),
		},
		descriptionColumn(),
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
			key: 'devices',
			label: tp('entity.device', 2),
			getValue: (r: DeviceRoleListRow): JSX.Element => (
				<a href={`/devices?role=${r.id}`}>{r.device_count}</a>
			),
		},
	]

	const deviceTypeColumns: DataTableColumn<DeviceTypeListRow>[] = [
		{
			key: 'model',
			label: t('common.model'),
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<a href={`/device-types/${dt.id}`}>{dt.model}</a>
			),
		},
		{
			key: 'manufacturer',
			label: tp('entity.manufacturer', 1),
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<a href={`/manufacturers/${dt.manufacturer_id}`}>
					{manufacturerName(dt.manufacturer_id)}
				</a>
			),
		},
		{
			key: 'role',
			label: t('deviceType.defaultRole'),
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<Show when={dt.default_device_role_id} fallback="—">
					{(roleId: () => number): JSX.Element => roleCell(roleId())}
				</Show>
			),
		},
		{
			key: 'u_height',
			label: t('common.heightU'),
			getValue: (dt: DeviceTypeListRow): string => `${dt.u_height}`,
		},
		{
			key: 'devices',
			label: tp('entity.device', 2),
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<a href={`/devices?device_type=${dt.id}`}>{dt.instance_count}</a>
			),
		},
	]

	const deviceColumns: DataTableColumn<DeviceListItem>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (d: DeviceListItem): JSX.Element => (
				<>
					<a href={deviceListHref(d)}>{d.name}</a>{' '}
					<Show when={d.kind === 'device' ? d : undefined}>
						{(dev: () => DeviceListDevice): JSX.Element => (
							<EolPill date={typeOf(dev().device_type_id)?.eol_date} />
						)}
					</Show>
				</>
			),
		},
		{
			key: 'status',
			label: t('common.status'),
			getValue: (d: DeviceListItem): JSX.Element => <DeviceStatusBadge status={d.status} />,
		},
		{
			key: 'role',
			label: tp('entity.deviceRole', 1),
			getValue: (d: DeviceListItem): JSX.Element => roleCell(d.device_role_id),
		},
		{
			key: 'type',
			label: t('common.type'),
			getValue: (d: DeviceListItem): JSX.Element =>
				d.kind === 'vm' ? (
					<span>{t('entity.virtualMachine.one')}</span>
				) : (
					<a href={`/device-types/${d.device_type_id}`}>
						{typeOf(d.device_type_id)?.model ?? '—'}
					</a>
				),
		},
	]

	const tabs = (): RelatedTab[] => [
		{
			key: 'children',
			label: t('deviceRole.children'),
			count: role()?.child_count ?? 0,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={children() ?? []}
					loading={children.loading}
					noun="noun.deviceRole"
					emptyText={t('deviceRole.noChildren')}
					columns={childColumns}
					all
				/>
			),
		},
		{
			key: 'device-types',
			label: tp('entity.deviceType', 2),
			count: role()?.device_type_count ?? 0,
			viewAllHref: `/device-types?role=${props.id}`,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={deviceTypes() ?? []}
					loading={deviceTypes.loading}
					noun="noun.deviceType"
					emptyText={t('deviceRole.noDeviceTypes')}
					columns={deviceTypeColumns}
				/>
			),
		},
		{
			key: 'devices',
			label: tp('entity.device', 2),
			count: role()?.device_count ?? 0,
			viewAllHref: `/devices?role=${props.id}`,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={devices() ?? []}
					loading={devices.loading}
					noun="noun.device"
					emptyText={t('deviceRole.noDevices')}
					rowKey={(row: DeviceListItem): string => `${row.kind}-${row.id}`}
					columns={deviceColumns}
				/>
			),
		},
	]

	return (
		<div>
			<DetailShell
				name={deviceRoleLabel(role())}
				record={role}
				loadingText={t('deviceRole.loadingOne')}
				emptyText={t('deviceRole.notFound')}
			>
				<DetailHeader
					name={deviceRoleLabel(role())}
					icon={deviceRoleIcon(role()?.icon)}
					editHref={`/device-roles/${props.id}/edit`}
					onDelete={handleDelete}
					deletable={role()?.key == null}
				/>
				<DetailSubtitle description={role()?.description} />

				<section class="spec-sheet" aria-label={t('deviceRole.details')}>
					<section>
						<h4>{t('deviceRole.section.hierarchy')}</h4>
						<dl>
							<dt>{t('deviceRole.parent')}</dt>
							<dd>
								<RecordLink
									id={parentId()}
									record={parent}
									base="/device-roles"
									label={deviceRoleLabel}
								/>
							</dd>
							<dt>{t('deviceRole.children')}</dt>
							<dd>
								<ScrollLink
									target="device-role-related"
									onFollow={() => setActiveTab('children')}
								>
									{role()?.child_count}
								</ScrollLink>
							</dd>
						</dl>
					</section>
					<section>
						<h4>{t('deviceRole.section.properties')}</h4>
						<dl>
							<dt>{t('deviceRole.canHostVms')}</dt>
							<dd>{role()?.can_host_vms === 1 ? t('common.yes') : t('common.no')}</dd>
							<dt>{tp('entity.managedBundle', 1)}</dt>
							<dd>
								<Show when={role()?.managed_bundle} fallback="—">
									{(
										b: () => NonNullable<DeviceRoleDetail['managed_bundle']>,
									): JSX.Element => (
										<a href={`/managed-bundles/${b().id}`}>
											{b().inherited
												? t('deviceRole.inheritedBundle', {
														name: b().name,
													})
												: b().name}
										</a>
									)}
								</Show>
							</dd>
						</dl>
					</section>
					<section>
						<h4>{t('deviceType.section.usage')}</h4>
						<dl>
							<dt>{tp('entity.deviceType', 2)}</dt>
							<dd>
								<ScrollLink
									target="device-role-related"
									onFollow={() => setActiveTab('device-types')}
								>
									{role()?.device_type_count}
								</ScrollLink>
							</dd>
							<dt>{tp('entity.device', 2)}</dt>
							<dd>
								<ScrollLink
									target="device-role-related"
									onFollow={() => setActiveTab('devices')}
								>
									{role()?.device_count}
								</ScrollLink>
							</dd>
						</dl>
					</section>
				</section>

				<RelatedTabs
					id="device-role-related"
					label={t('deviceRole.related')}
					tabs={tabs()}
					active={activeTab()}
					onActiveChange={setActiveTab}
				/>
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}
