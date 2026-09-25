import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import {
	type DeviceTypeRow,
	delete_manufacturer,
	fetch_device_types,
	fetch_manufacturer,
} from '../api_templates'
import { DataTable } from '../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	InlineError,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { t, tp } from '../i18n'

/**
 * /manufacturers/:id — manufacturer detail: header with description
 * and the related device-types table.
 */
export function ManufacturerDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)

	const [manufacturer] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_manufacturer(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const [deviceTypes] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_device_types(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items
		},
	)

	const { handleDelete } = useDetailDelete({
		noun: 'noun.manufacturer',
		name: () => manufacturer()?.name,
		id: props.id,
		remove: delete_manufacturer,
		setError,
		listRoute: '/manufacturers',
	})

	const typeCount = (): number => deviceTypes()?.length ?? 0

	return (
		<div>
			<DetailShell
				backTo="/manufacturers"
				backLabel={tp('entity.manufacturer', 2)}
				loading={manufacturer.loading}
				loadingText={t('manufacturer.loadingOne')}
				record={manufacturer()}
				emptyText={t('manufacturer.notFound')}
			>
				<DetailHeader
					name={manufacturer()?.name}
					editHref={`/manufacturers/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>
					{manufacturer()?.description || t('common.noDescription')}
				</DetailSubtitle>

				<DetailCard label={t('manufacturer.details')}>
					<dt>{t('common.description')}</dt>
					<dd>{manufacturer()?.description || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="manufacturer-device-types"
				title={tp('entity.deviceType', 2)}
				count={typeCount()}
				loading={deviceTypes.loading}
				loadingText={t('list.loading', { noun: tp('noun.deviceType', 2) })}
				emptyText={t('manufacturer.noDeviceTypes')}
				hasItems={typeCount() > 0}
				viewAllHref={`/device-types?manufacturer=${props.id}`}
				viewAllLabel={t('common.viewIn', { target: tp('entity.deviceType', 2) })}
			>
				<DataTable
					rows={() => deviceTypes() ?? []}
					getRowId={(dt: DeviceTypeRow): number => dt.id}
					showColumnCustomizer
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
							getValue: (dt: DeviceTypeRow): string =>
								dt.is_full_depth ? t('common.yes') : t('common.no'),
						},
					]}
				/>
			</RelatedSection>

			<InlineError message={error()} />
		</div>
	)
}
