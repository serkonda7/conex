import { DataTable } from '@serkonda7/solid-components'
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import {
	type DeviceTypeRow,
	delete_manufacturer,
	fetch_device_types,
	fetch_manufacturer,
} from '../api_templates'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

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

	async function handleDelete(): Promise<void> {
		const m = manufacturer()
		if (!m) {
			return
		}
		if (!window.confirm(`Delete manufacturer "${m.name}"?`)) {
			return
		}
		setError(null)
		const res = await delete_manufacturer(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		navigate('/manufacturers', { refresh: true })
	}

	const typeCount = (): number => deviceTypes()?.length ?? 0

	return (
		<div>
			<p>
				<a href="/manufacturers" onClick={(e: MouseEvent): void => go(e, '/manufacturers')}>
					← Manufacturers
				</a>
			</p>
			<Show
				when={!manufacturer.loading}
				fallback={<p class="skeleton">Loading manufacturer…</p>}
			>
				<Show when={manufacturer()} fallback={<p class="empty">Manufacturer not found.</p>}>
					<div class="page-header">
						<h2>{manufacturer()?.name}</h2>
						<div class="form-actions">
							<button
								type="button"
								onClick={() => navigate(`/manufacturers/${props.id}/edit`)}
							>
								<span aria-hidden="true" class="app-nav-icon">
									<IconPencil size={14} />
								</span>{' '}
								Edit
							</button>
							<button type="button" class="btn-danger" onClick={handleDelete}>
								<span aria-hidden="true" class="app-nav-icon">
									<IconTrash size={14} />
								</span>{' '}
								Delete
							</button>
						</div>
					</div>
					<p class="page-subtitle">{manufacturer()?.description || 'No description.'}</p>

					<section class="card" aria-label="Manufacturer details">
						<dl class="detail-grid">
							<dt>Description</dt>
							<dd>{manufacturer()?.description || '—'}</dd>
						</dl>
					</section>
				</Show>
			</Show>

			<h3 id="manufacturer-device-types">
				Device types <span class="badge">{typeCount()}</span>
			</h3>
			<Show
				when={!deviceTypes.loading}
				fallback={<p class="skeleton">Loading device types…</p>}
			>
				<Show
					when={typeCount() > 0}
					fallback={<p class="empty">No device types for this manufacturer yet.</p>}
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
				</Show>
			</Show>
			<p>
				<a
					href={`/device-types?manufacturer=${props.id}`}
					onClick={(e: MouseEvent): void =>
						go(e, `/device-types?manufacturer=${props.id}`)
					}
				>
					View in Device types →
				</a>
			</p>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
