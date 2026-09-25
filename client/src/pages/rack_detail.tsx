import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { ElevationShelfDeviceRef, ElevationShelfRef } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createMemo, createResource, createSignal, Show } from 'solid-js'
import { type DeviceRow, fetch_devices, update_device } from '../api_devices'
import { delete_rack, fetch_elevation, fetch_rack } from '../api_racks'
import {
	type DeviceTypeRow,
	fetch_device_type,
	fetch_device_types,
	fetch_manufacturers,
} from '../api_templates'
import { fetch_location, fetch_site, fetch_tenant } from '../api_tenancy'
import { DataTable } from '../components/data_table'
import {
	DetailCard,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	InlineError,
	Loading,
	useDetailDelete,
} from '../components/detail_page'
import { useSort } from '../components/list_page'
import { ObjectSelector } from '../components/object_selector'
import { RackElevation, type RackFace } from '../components/rack_elevation'
import { t, tp } from '../i18n'
import { faceLabel } from '../i18n/labels'
import { type Crumb, navigate } from '../router'
import { locationTrail } from '../trails'

/**
 * /racks/:id — rack detail: header with name/description, two-column
 * layout (details left, elevation right) with a utilization strip and the
 * NetBox-like visual elevation (front/rear faces, spanning multi-U blocks,
 * click-free-U to install devices or shelves).
 */
export function RackDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [pendingU, setPendingU] = createSignal<number | null>(null)
	const [face, setFace] = createSignal<RackFace>('front')
	const [selectingDevice, setSelectingDevice] = createSignal(false)
	/** Shelf the device selector places onto; null = the pending U. */
	const [targetShelf, setTargetShelf] = createSignal<ElevationShelfRef | null>(null)

	const [rack] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_rack(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const siteId = createMemo(() => rack()?.site_id ?? null)
	const [site] = createResource(siteId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_site(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const locationId = createMemo(() => rack()?.location_id ?? null)
	const [location] = createResource(locationId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_location(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [trail] = createResource(
		() => ({ site: site(), location: locationId() }),
		async ({ site: siteRow, location: locationKey }): Promise<Crumb[]> => {
			if (!siteRow) {
				return []
			}
			const locations = await locationTrail(siteRow.id, locationKey)
			return [{ label: siteRow.name, href: `/sites/${siteRow.id}` }, ...locations]
		},
	)
	const tenantId = createMemo(() => rack()?.tenant_id ?? null)
	const [tenant] = createResource(tenantId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_tenant(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const rackTypeId = createMemo(() => rack()?.rack_type_id ?? null)
	const [rackType] = createResource(rackTypeId, async (id: number | null) => {
		if (!id) {
			return null
		}
		const res = await fetch_device_type(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [elevation, { refetch }] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_elevation(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const [unrackedDevices, { refetch: refetchUnrackedDevices }] = createResource(
		() => props.id,
		async (id: number) => {
			const result = await fetch_devices({ rack: id })
			if (Result.isError(result)) {
				setError(result.error.message)
				return []
			}
			return result.value.items.filter(
				(device) => device.position_u === null && device.shelf_id === null,
			)
		},
	)
	const [deviceTypes] = createResource(async () => {
		const result = await fetch_device_types()
		if (Result.isError(result)) {
			setError(result.error.message)
			return []
		}
		return result.value.items
	})
	const [manufacturers] = createResource(async () => {
		const result = await fetch_manufacturers()
		if (Result.isError(result)) {
			setError(result.error.message)
			return []
		}
		return result.value.items
	})

	function deviceTypeOf(id: number): DeviceTypeRow | undefined {
		return deviceTypes()?.find((type) => type.id === id)
	}

	function manufacturerNameOf(deviceTypeId: number): string {
		const manufacturerId = deviceTypeOf(deviceTypeId)?.manufacturer_id
		return (
			manufacturers()?.find((manufacturer) => manufacturer.id === manufacturerId)?.name ??
			(manufacturerId === undefined ? '—' : String(manufacturerId))
		)
	}
	const { sort, order, handleSort, clearSort } = useSort<'name' | 'type' | 'manufacturer'>('name')
	const sortedUnrackedDevices = createMemo(() => {
		const rows = [...(unrackedDevices() ?? [])]
		const key = sort()
		if (!key) {
			return rows
		}
		const fieldValue = (device: DeviceRow): string => {
			switch (key) {
				case 'name':
					return device.name
				case 'type':
					return deviceTypeOf(device.device_type_id)?.model ?? ''
				case 'manufacturer':
					return manufacturerNameOf(device.device_type_id)
			}
		}
		return rows.sort((a, b) => {
			const comparison = fieldValue(a).localeCompare(fieldValue(b), undefined, {
				sensitivity: 'base',
			})
			return order() === 'asc' ? comparison : -comparison
		})
	})

	const occupiedU = createMemo(
		() => elevation()?.units.filter((u) => u.device !== null || u.shelf !== null).length ?? 0,
	)
	/** Rack height is owned by the rack type; the stored rack row is only a fallback. */
	const displayHeight = createMemo(
		() => elevation()?.height_u ?? rackType()?.u_height ?? rack()?.height_u ?? 0,
	)
	const totalU = displayHeight
	const utilPct = createMemo(() =>
		totalU() > 0 ? Math.round((occupiedU() / totalU()) * 100) : 0,
	)
	const { handleDelete } = useDetailDelete({
		noun: 'noun.rack',
		name: () => rack()?.name,
		id: props.id,
		remove: delete_rack,
		setError,
		listRoute: '/racks',
	})

	function pickU(u: number, pickedFace: RackFace): void {
		setPendingU(u)
		setFace(pickedFace)
	}

	function installDevice(u: number, targetFace: RackFace = face()): void {
		navigate(`/devices/add?rack=${props.id}&position_u=${u}&face=${targetFace}`)
	}

	function installShelf(u: number, targetFace: RackFace = face()): void {
		navigate(`/shelves/add?rack=${props.id}&position_u=${u}&face=${targetFace}`)
	}

	function openDeviceSelector(u: number, targetFace: RackFace): void {
		pickU(u, targetFace)
		setTargetShelf(null)
		setSelectingDevice(true)
	}

	function openShelfDeviceSelector(shelf: ElevationShelfRef): void {
		setTargetShelf(shelf)
		setSelectingDevice(true)
	}

	function refreshPlacement(result: Result<DeviceRow, Error>): void {
		if (Result.isError(result)) {
			setError(result.error.message)
			return
		}
		void refetch()
		void refetchUnrackedDevices()
	}

	async function placeOnShelf(device: DeviceRow, shelf: ElevationShelfRef): Promise<void> {
		setSelectingDevice(false)
		setTargetShelf(null)
		setError(null)
		refreshPlacement(await update_device(device.id, { shelf_id: shelf.id }))
	}

	/** Takes a device off its shelf; it stays assigned to this rack. */
	async function removeFromShelf(device: ElevationShelfDeviceRef): Promise<void> {
		setError(null)
		refreshPlacement(await update_device(device.id, { shelf_id: null }))
	}

	async function placeDevice(device: DeviceRow): Promise<void> {
		const shelf = targetShelf()
		if (shelf) {
			await placeOnShelf(device, shelf)
			return
		}
		const u = pendingU()
		if (u === null) {
			return
		}
		setSelectingDevice(false)
		setError(null)
		const result = await update_device(device.id, {
			rack_id: props.id,
			position_u: u,
			face: face(),
		})
		if (Result.isError(result)) {
			setError(result.error.message)
			return
		}
		void refetch()
		void refetchUnrackedDevices()
	}

	return (
		<div>
			<DetailShell
				name={rack()?.name}
				crumbs={trail()}
				loading={rack.loading}
				loadingText={t('rack.loadingOne')}
				record={rack()}
				emptyText={t('rack.notFound')}
			>
				<div class="page-header">
					<h2 data-testid="rack-detail-title">
						{rack()?.name}{' '}
						<span>{t('common.heightUnits', { count: displayHeight() })}</span>
					</h2>
					<div class="form-actions">
						<button type="button" onClick={() => navigate(`/racks/${props.id}/edit`)}>
							<span aria-hidden="true" class="app-nav-icon">
								<IconPencil size={14} />
							</span>{' '}
							{t('common.edit')}
						</button>
						<button type="button" class="btn-danger" onClick={handleDelete}>
							<span aria-hidden="true" class="app-nav-icon">
								<IconTrash size={14} />
							</span>{' '}
							{t('common.delete')}
						</button>
					</div>
				</div>
				<DetailSubtitle>{rack()?.description || t('common.noDescription')}</DetailSubtitle>

				<div class="detail-columns">
					<div>
						<DetailCard label={t('rack.details')}>
							<dt>{tp('entity.tenant', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={tenantId()}
									loading={tenant.loading}
									name={tenant()?.name}
									href={`/tenants/${tenantId() ?? ''}`}
								/>
							</dd>
							<dt>{tp('entity.site', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={siteId()}
									loading={site.loading}
									name={site()?.name}
									href={`/sites/${siteId() ?? ''}`}
								/>
							</dd>
							<dt>{tp('entity.location', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={locationId()}
									loading={location.loading}
									name={location()?.name}
									href={`/locations/${locationId() ?? ''}`}
								/>
							</dd>
							<dt>{tp('entity.rackType', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={rackType()?.manufacturer_id ?? null}
									loading={manufacturers.loading}
									name={
										manufacturers()?.find(
											(m) => m.id === rackType()?.manufacturer_id,
										)?.name
									}
									href={`/manufacturers/${rackType()?.manufacturer_id ?? ''}`}
								/>
								{' / '}
								<ForeignKeyLink
									id={rackTypeId()}
									loading={rackType.loading}
									name={rackType()?.model}
									href={`/device-types/${rackTypeId() ?? ''}`}
								/>
							</dd>
						</DetailCard>

						<section class="rack-unracked" aria-label={t('rack.unracked')}>
							<h3>
								{t('rack.unracked')}{' '}
								<span class="badge">{unrackedDevices()?.length ?? 0}</span>
							</h3>
							<Show
								when={
									!unrackedDevices.loading &&
									!deviceTypes.loading &&
									!manufacturers.loading
								}
								fallback={<Loading message={t('rack.loadingUnracked')} />}
							>
								<Show
									when={(unrackedDevices()?.length ?? 0) > 0}
									fallback={
										<p class="rack-unracked-empty">{t('rack.noUnracked')}</p>
									}
								>
									<DataTable
										rows={sortedUnrackedDevices}
										getRowId={(device: DeviceRow): number => device.id}
										sortKey={sort}
										sortDirection={order}
										onSort={handleSort}
										onSortClear={clearSort}
										columns={[
											{
												key: 'name',
												label: t('common.name'),
												sortable: true,
												getValue: (device: DeviceRow): JSX.Element => (
													<a
														href={`/devices/${device.id}`}
														onClick={(e: MouseEvent): void => {
															e.preventDefault()
															navigate(`/devices/${device.id}`)
														}}
													>
														{device.name}
													</a>
												),
											},
											{
												key: 'type',
												label: t('common.type'),
												sortable: true,
												getValue: (device: DeviceRow): string =>
													deviceTypeOf(device.device_type_id)?.model ??
													String(device.device_type_id),
											},
											{
												key: 'manufacturer',
												label: tp('entity.manufacturer', 1),
												sortable: true,
												getValue: (device: DeviceRow): string =>
													manufacturerNameOf(device.device_type_id),
											},
										]}
									/>
								</Show>
							</Show>
						</section>
					</div>

					<div>
						<div
							class="rack-util"
							data-testid="rack-utilization"
							role="status"
							aria-label={t('rack.utilLabel', { used: occupiedU(), total: totalU() })}
						>
							<span>
								{t('rack.util', {
									used: occupiedU(),
									total: totalU(),
									pct: utilPct(),
								})}
							</span>
							<span class="rack-util-bar" aria-hidden="true">
								<span class="rack-util-fill" style={{ width: `${utilPct()}%` }} />
							</span>
						</div>
						<Show
							when={elevation()}
							fallback={<Loading message={t('rack.loadingElevation')} />}
						>
							<RackElevation
								units={elevation()?.units ?? []}
								shelves={elevation()?.shelves ?? []}
								selected_u={pendingU()}
								selected_face={face()}
								on_select_u={pickU}
								on_select_device={openDeviceSelector}
								on_add_device={installDevice}
								on_add_shelf={installShelf}
								shelf_actions={{
									on_select_shelf_device: openShelfDeviceSelector,
									on_remove_shelf_device: (
										device: ElevationShelfDeviceRef,
									): void => void removeFromShelf(device),
								}}
							/>
						</Show>
						<Show when={selectingDevice()}>
							<ObjectSelector
								label={
									targetShelf()
										? t('rack.selectDeviceForShelf', {
												name:
													targetShelf()?.name ||
													t('common.unitPosition', {
														u: targetShelf()?.position_u ?? '',
													}),
											})
										: t('rack.selectDeviceForU', {
												unit: t('common.unitPosition', {
													u: pendingU() ?? '',
												}),
												face: faceLabel(face()),
											})
								}
								placeholder={t('rack.searchDevices')}
								load={async (search: string) => {
									const result = await fetch_devices({ search })
									return Result.isError(result)
										? Result.err(result.error)
										: Result.ok(result.value.items)
								}}
								get_label={(device: DeviceRow) => device.name}
								on_select={(device: DeviceRow) => void placeDevice(device)}
								on_close={() => {
									setSelectingDevice(false)
									setTargetShelf(null)
								}}
							/>
						</Show>
					</div>
				</div>
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}
