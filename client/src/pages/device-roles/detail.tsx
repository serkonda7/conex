import { createSignal, type JSX, Show } from 'solid-js'
import {
	type DeviceRoleListRow,
	delete_device_role,
	fetch_device_role,
	fetch_device_roles,
} from '../../api/device_roles'
import { type DeviceListItem, fetch_device_list } from '../../api/devices'
import { nameColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RecordLink,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { deviceRoleIconLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { createRecord, createRowsFor } from '../../lib/resource'
import { deviceListHref } from '../devices/list'

/**
 * /device-roles/:id — device role detail: header with description, the
 * child roles, and the related devices table (including child roles' devices).
 */
export function DeviceRoleDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [role] = createRecord(id, fetch_device_role, setError)
	const parentId = (): number | null | undefined => role()?.parent_id
	const [parent] = createRecord(parentId, fetch_device_role, setError)
	const [children] = createRowsFor(
		id,
		(key: number) => fetch_device_roles({ parent: key }),
		setError,
	)
	const [devices] = createRowsFor(id, (key: number) => fetch_device_list({ role: key }), setError)

	const handleDelete = useDetailDelete({
		noun: 'noun.deviceRole',
		name: () => role()?.name,
		id: props.id,
		remove: delete_device_role,
		setError,
		listRoute: '/device-roles',
	})

	return (
		<div>
			<DetailShell
				name={role()?.name}
				record={role}
				loadingText={t('deviceRole.loadingOne')}
				emptyText={t('deviceRole.notFound')}
			>
				<DetailHeader
					name={role()?.name}
					editHref={`/device-roles/${props.id}/edit`}
					onDelete={handleDelete}
					deletable={role()?.key == null}
				/>
				<DetailSubtitle description={role()?.description} />

				<DetailCard label={t('deviceRole.details')}>
					<dt>{t('deviceRole.parent')}</dt>
					<dd>
						<RecordLink id={parentId()} record={parent} base="/device-roles" />
					</dd>
					<dt>{t('deviceRole.icon')}</dt>
					<dd>
						<Show when={role()?.icon} fallback="—">
							{(icon: () => string): JSX.Element => (
								<IconLabel icon={deviceRoleIcon(icon())}>
									{deviceRoleIconLabel(icon())}
								</IconLabel>
							)}
						</Show>
					</dd>
					<dt>{t('deviceRole.canHostVms')}</dt>
					<dd>{role()?.can_host_vms === 1 ? t('common.yes') : t('common.no')}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="device-role-children"
				title={t('deviceRole.children')}
				rows={children}
				loadingText={t('deviceRole.loadingChildren')}
				emptyText={t('deviceRole.noChildren')}
				customizable
				columns={[nameColumn<DeviceRoleListRow>(t('common.name'), '/device-roles')]}
			/>

			<RelatedSection
				id="device-role-devices"
				title={tp('entity.device', 2)}
				noun="noun.device"
				rows={devices}
				emptyText={t('deviceRole.noDevices')}
				viewAllHref={`/devices?role=${props.id}`}
				customizable
				rowKey={(row: DeviceListItem): string => `${row.kind}-${row.id}`}
				columns={[
					{
						key: 'name',
						label: t('common.name'),
						getValue: (row: DeviceListItem): JSX.Element => (
							<a href={deviceListHref(row)}>{row.name}</a>
						),
					},
				]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
