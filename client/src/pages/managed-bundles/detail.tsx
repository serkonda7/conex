import { createSignal, type JSX } from 'solid-js'
import { type DeviceRoleListRow, fetch_device_roles } from '../../api/device_roles'
import { delete_managed_bundle, fetch_managed_bundle } from '../../api/service_catalog'
import { nameColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { deviceRoleLabel } from '../../i18n/labels'
import { createRecord, createRows } from '../../lib/resource'

/**
 * /managed-bundles/:id — managed bundle detail: header with description and
 * the device roles mapped onto it (child roles without an own bundle
 * inherit it and are not listed).
 */
export function ManagedBundleDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [bundle] = createRecord(id, fetch_managed_bundle, setError)
	const [roles] = createRows(fetch_device_roles, setError)

	const handleDelete = useDetailDelete({
		noun: 'noun.managedBundle',
		name: () => bundle()?.name,
		id: props.id,
		remove: delete_managed_bundle,
		setError,
		listRoute: '/managed-bundles',
	})

	return (
		<div>
			<DetailShell
				name={bundle()?.name}
				record={bundle}
				loadingText={t('managedBundle.loadingOne')}
				emptyText={t('managedBundle.notFound')}
			>
				<DetailHeader
					name={bundle()?.name}
					editHref={`/managed-bundles/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={bundle()?.description} />
			</DetailShell>

			<RelatedSection
				id="managed-bundle-roles"
				title={tp('entity.deviceRole', 2)}
				noun="noun.deviceRole"
				rows={roles}
				select={(rows: DeviceRoleListRow[]) =>
					rows.filter((role) => role.managed_bundle_id === props.id)
				}
				emptyText={t('managedBundle.noRoles')}
				columns={[
					nameColumn<DeviceRoleListRow>(t('common.name'), '/device-roles', {
						rowLabel: deviceRoleLabel,
					}),
				]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
