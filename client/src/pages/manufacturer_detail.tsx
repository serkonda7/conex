import { DataTable } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import {
	type DeviceTypeRow,
	delete_manufacturer,
	fetch_device_types,
	fetch_manufacturer,
} from '../api_templates'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	InlineError,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'

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
		noun: 'manufacturer',
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
				backLabel="Manufacturers"
				loading={manufacturer.loading}
				loadingText="Loading manufacturer…"
				record={manufacturer()}
				emptyText="Manufacturer not found."
			>
				<DetailHeader
					name={manufacturer()?.name}
					editHref={`/manufacturers/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{manufacturer()?.description || 'No description.'}</DetailSubtitle>

				<DetailCard label="Manufacturer details">
					<dt>Description</dt>
					<dd>{manufacturer()?.description || '—'}</dd>
				</DetailCard>
			</DetailShell>

			<RelatedSection
				id="manufacturer-device-types"
				title="Device types"
				count={typeCount()}
				loading={deviceTypes.loading}
				loadingText="Loading device types…"
				emptyText="No device types for this manufacturer yet."
				hasItems={typeCount() > 0}
				viewAllHref={`/device-types?manufacturer=${props.id}`}
				viewAllLabel="View in Device types →"
			>
				<DataTable
					rows={() => deviceTypes() ?? []}
					getRowId={(t: DeviceTypeRow): number => t.id}
					showColumnCustomizer
					columns={[
						{
							key: 'model',
							label: 'Model',
							getValue: (t: DeviceTypeRow): string => t.model,
						},
						{
							key: 'u_height',
							label: 'U height',
							getValue: (t: DeviceTypeRow): string => `${t.u_height}`,
						},
						{
							key: 'is_full_depth',
							label: 'Full depth',
							getValue: (t: DeviceTypeRow): string =>
								t.is_full_depth ? 'Yes' : 'No',
						},
					]}
				/>
			</RelatedSection>

			<InlineError message={error()} />
		</div>
	)
}
