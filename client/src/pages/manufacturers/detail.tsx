import { createSignal, type JSX } from 'solid-js'
import {
	type DeviceTypeRow,
	delete_manufacturer,
	fetch_device_types,
	fetch_manufacturer,
} from '../../api/templates'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { yesNo } from '../../i18n/labels'
import { createRecord, createRowsFor } from '../../lib/resource'

/**
 * /manufacturers/:id — manufacturer detail: header with description
 * and the related device-types table.
 */
export function ManufacturerDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [manufacturer] = createRecord(id, fetch_manufacturer, setError)
	const [deviceTypes] = createRowsFor(
		id,
		(key: number) => fetch_device_types({ manufacturer: key }),
		setError,
	)

	const handleDelete = useDetailDelete({
		noun: 'noun.manufacturer',
		name: () => manufacturer()?.name,
		id: props.id,
		remove: delete_manufacturer,
		setError,
		listRoute: '/manufacturers',
	})

	return (
		<div>
			<DetailShell
				name={manufacturer()?.name}
				record={manufacturer}
				loadingText={t('manufacturer.loadingOne')}
				emptyText={t('manufacturer.notFound')}
			>
				<DetailHeader
					name={manufacturer()?.name}
					editHref={`/manufacturers/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={manufacturer()?.description} />
			</DetailShell>

			<RelatedSection
				id="manufacturer-device-types"
				title={tp('entity.deviceType', 2)}
				noun="noun.deviceType"
				rows={deviceTypes}
				emptyText={t('manufacturer.noDeviceTypes')}
				viewAllHref={`/device-types?manufacturer=${props.id}`}
				customizable
				columns={[
					{
						key: 'model',
						label: t('common.model'),
						getValue: (dt: DeviceTypeRow): string => dt.model,
					},
					{
						key: 'u_height',
						label: t('common.heightU'),
						getValue: (dt: DeviceTypeRow): string => `${dt.u_height}`,
					},
					{
						key: 'is_full_depth',
						label: t('common.fullDepth'),
						getValue: (dt: DeviceTypeRow): string => yesNo(dt.is_full_depth),
					},
				]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
