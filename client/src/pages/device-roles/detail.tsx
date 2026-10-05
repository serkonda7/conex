import { createSignal, type JSX } from 'solid-js'
import { delete_device_role, fetch_device_role } from '../../api/device_roles'
import { type DeviceRow, fetch_devices } from '../../api/devices'
import { nameColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { createRecord, createRowsFor } from '../../lib/resource'

/**
 * /device-roles/:id — device role detail: header with description
 * and the related devices table.
 */
export function DeviceRoleDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [role] = createRecord(id, fetch_device_role, setError)
	const [devices] = createRowsFor(id, (key: number) => fetch_devices({ role: key }), setError)

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
				/>
				<DetailSubtitle description={role()?.description} />

				<DetailCard label={t('deviceRole.details')}>
					<dt>{t('common.description')}</dt>
					<dd>{role()?.description || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="device-role-devices"
				title={tp('entity.device', 2)}
				noun="noun.device"
				rows={devices}
				emptyText={t('deviceRole.noDevices')}
				viewAllHref={`/devices?role=${props.id}`}
				customizable
				columns={[nameColumn<DeviceRow>(t('common.name'), '/devices')]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
