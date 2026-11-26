import { Result } from 'better-result'
import type {
	ElevationDeviceRef,
	ElevationShelfDeviceRef,
	ElevationShelfRef,
} from 'shared/src/types'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import { type DeviceRow, fetch_devices, swap_devices, update_device } from '../../api/devices'
import {
	delete_rack,
	fetch_elevation,
	fetch_rack,
	fetch_rack_faceplates,
	fetch_racks,
} from '../../api/racks'
import {
	type DeviceTypeRow,
	fetch_device_types,
	fetch_manufacturers,
	fetch_rack_type,
} from '../../api/templates'
import { fetch_location, fetch_site, fetch_tenant } from '../../api/tenancy'
import { AttachmentsSection, createOwnerImages } from '../../components/attachments'
import { DataTable, type DataTableColumn, nameColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	RecordLink,
	useDetailDelete,
} from '../../components/detail_page'
import type { FaceplateViewPort } from '../../components/faceplate'
import { InlineError, Loading } from '../../components/feedback'
import { FloorplanLinks } from '../../components/floorplan_links'
import { useSort } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { faceLabel } from '../../i18n/labels'
import { FEATURES } from '../../lib/features'
import { useNameOf } from '../../lib/lookup'
import { createDerived, createRecord, createRows, createRowsFor } from '../../lib/resource'
import { type Crumb, navigate } from '../../lib/router'
import { can } from '../../lib/session'
import { readStored, writeStored } from '../../lib/storage'
import { siteTrail } from '../../lib/trails'
import { RackDeviceDialog } from './device_dialog'
import { RackElevation, type RackFace } from './elevation'

/** How the elevation shows devices; remembered per browser. */
type ElevationDisplay = 'labels' | 'images'

const DISPLAY_KEY = 'conex:rackElevationDisplay'
const DISPLAYS: ElevationDisplay[] = ['labels', 'images']

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

	const id = (): number => props.id
	const [rack] = createRecord(id, fetch_rack, setError)
	const siteId = (): number | undefined => rack()?.site_id
	const locationId = (): number | null | undefined => rack()?.location_id
	const tenantId = (): number | null | undefined => rack()?.tenant_id
	const rackTypeId = (): number | null | undefined => rack()?.rack_type_id
	const [site] = createRecord(siteId, fetch_site, setError)
	const [location] = createRecord(locationId, fetch_location, setError)
	const [tenant] = createRecord(tenantId, fetch_tenant, setError)
	const [rackType] = createRecord(rackTypeId, fetch_rack_type, setError)
	const images = createOwnerImages({ rack_id: props.id }, setError)
	const trail = createDerived(
		() => ({ site: site(), location: locationId() ?? null }),
		({ site: siteRow, location: locationKey }): Promise<Crumb[]> =>
			siteTrail(siteRow, locationKey),
	)
	const [elevation] = createRecord(id, fetch_elevation, setError)
	const [display, setDisplayState] = createSignal<ElevationDisplay>(
		FEATURES.schematics && readStored(DISPLAY_KEY) === 'images' ? 'images' : 'labels',
	)
	const setDisplay = (value: ElevationDisplay): void => {
		setDisplayState(value)
		writeStored(DISPLAY_KEY, value)
	}
	// Ports load only once the images show.
	const faceplateKey = (): number | undefined => (display() === 'images' ? id() : undefined)
	const [faceplates] = createRecord(faceplateKey, fetch_rack_faceplates, setError)
	const faceplatePorts = createMemo(
		(): ReadonlyMap<number, readonly FaceplateViewPort[]> | undefined => {
			const loaded = faceplates()
			if (display() !== 'images' || !loaded) {
				return undefined
			}
			return new Map(loaded.devices.map((entry) => [entry.device_id, entry.ports]))
		},
	)
	const [rackDevices] = createRowsFor(
		id,
		(key: number) => fetch_devices({ rack: [key] }),
		setError,
	)
	const unrackedDevices = (): DeviceRow[] =>
		(rackDevices() ?? []).filter((d) => d.position_u === null && d.shelf_id === null)
	const [deviceTypes] = createRows(fetch_device_types, setError)
	const [manufacturers] = createRows(fetch_manufacturers, setError)
	const manufacturerName = useNameOf(manufacturers)
	const [racks] = createRows(fetch_racks, setError)
	const rackName = useNameOf(racks)
	/** Where a candidate device is already racked, shown in the device selector. */
	function placementNote(device: DeviceRow): string | undefined {
		if (device.rack_id === null) {
			return undefined
		}
		const rackLabel = rackName(device.rack_id)
		const place =
			device.shelf_id !== null
				? `${rackLabel} · ${t('elevation.onShelf')}`
				: device.position_u !== null
					? `${t('device.mountPosition', { rack: rackLabel, u: device.position_u })}${device.face ? ` (${faceLabel(device.face)})` : ''}`
					: rackLabel
		return t('device.rackedIn', { place })
	}

	function deviceTypeOf(typeId: number): DeviceTypeRow | undefined {
		return deviceTypes()?.find((type) => type.id === typeId)
	}

	function manufacturerNameOf(deviceTypeId: number): string {
		return manufacturerName(deviceTypeOf(deviceTypeId)?.manufacturer_id)
	}
	const { sort, order, handleSort, clearSort } = useSort<'name' | 'type' | 'manufacturer'>('name')
	const sortedUnrackedDevices = createMemo(() => {
		const rows = [...unrackedDevices()]
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

	const unrackedColumns: DataTableColumn<DeviceRow>[] = [
		nameColumn(t('common.name'), '/devices', { sortable: true }),
		{
			key: 'type',
			label: t('common.type'),
			sortable: true,
			getValue: (device: DeviceRow): string =>
				deviceTypeOf(device.device_type_id)?.model ?? String(device.device_type_id),
		},
		{
			key: 'manufacturer',
			label: tp('entity.manufacturer', 1),
			sortable: true,
			getValue: (device: DeviceRow): string => manufacturerNameOf(device.device_type_id),
		},
	]

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
	const handleDelete = useDetailDelete({
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

	/** Device-add deep link carrying the rack's tenant, site and location. */
	function deviceAddRoute(extra: Record<string, string>): string {
		const params = new URLSearchParams({ rack: String(props.id), ...extra })
		const currentRack = rack()
		if (currentRack?.tenant_id !== null && currentRack?.tenant_id !== undefined) {
			params.set('tenant', String(currentRack.tenant_id))
		}
		if (currentRack?.site_id !== null && currentRack?.site_id !== undefined) {
			params.set('site', String(currentRack.site_id))
		}
		if (currentRack?.location_id !== null && currentRack?.location_id !== undefined) {
			params.set('location', String(currentRack.location_id))
		}
		return `/devices/add?${params.toString()}`
	}

	function installDevice(u: number, targetFace: RackFace = face()): void {
		navigate(deviceAddRoute({ position_u: String(u), face: targetFace }))
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

	function addShelfDevice(shelf: ElevationShelfRef): void {
		navigate(deviceAddRoute({ shelf: String(shelf.id) }))
	}

	function refreshPlacement(result: Result<DeviceRow, Error>): void {
		if (Result.isError(result)) {
			setError(result.error.message)
		}
	}

	/** Takes a device off its shelf; it stays assigned to this rack. */
	async function removeFromShelf(device: ElevationShelfDeviceRef): Promise<void> {
		setError(null)
		refreshPlacement(await update_device(device.id, { shelf_id: null }))
	}

	/** Drag and drop: remounts a device at another U or face of this rack. */
	async function moveDevice(
		device: ElevationDeviceRef,
		position_u: number,
		targetFace: RackFace | null,
	): Promise<void> {
		setError(null)
		refreshPlacement(await update_device(device.id, { position_u, face: targetFace }))
	}

	/** Drag and drop onto another device: the two trade places. */
	async function swapDevices(
		device: ElevationDeviceRef,
		other: ElevationDeviceRef,
	): Promise<void> {
		setError(null)
		const result = await swap_devices(device.id, other.id)
		if (Result.isError(result)) {
			setError(result.error.message)
		}
	}

	/** Places the device at the pending U or onto the target shelf. */
	function placeDevice(device: DeviceRow): Promise<Result<DeviceRow, Error>> {
		const shelf = targetShelf()
		return shelf
			? update_device(device.id, { shelf_id: shelf.id })
			: update_device(device.id, {
					rack_id: props.id,
					position_u: pendingU(),
					face: face(),
				})
	}

	return (
		<div>
			<DetailShell
				name={rack()?.name}
				crumbs={trail()}
				record={rack}
				loadingText={t('rack.loadingOne')}
				emptyText={t('rack.notFound')}
			>
				<DetailHeader
					name={rack()?.name}
					extra={<span>{t('common.heightUnits', { count: displayHeight() })}</span>}
					testId="rack-detail-title"
					editHref={`/racks/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={rack()?.description} />

				<div class="detail-columns">
					<div>
						<DetailCard label={t('rack.details')}>
							<dt>{tp('entity.tenant', 1)}</dt>
							<dd>
								<RecordLink id={tenantId()} record={tenant} base="/tenants" />
							</dd>
							<dt>{tp('entity.site', 1)}</dt>
							<dd>
								<RecordLink id={siteId()} record={site} base="/sites" />
							</dd>
							<dt>{tp('entity.location', 1)}</dt>
							<dd>
								<RecordLink id={locationId()} record={location} base="/locations" />
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
									href={`/rack-types/${rackTypeId() ?? ''}`}
								/>
							</dd>
							<FloorplanLinks
								target={{ rack: props.id }}
								label="floorplan.onPlanOf"
								onError={setError}
							/>
						</DetailCard>

						<section class="rack-unracked" aria-label={t('rack.unracked')}>
							<h3>
								{t('rack.unracked')}{' '}
								<span class="badge">{unrackedDevices().length}</span>
							</h3>
							<Show
								when={
									!rackDevices.loading &&
									!deviceTypes.loading &&
									!manufacturers.loading
								}
								fallback={<Loading message={t('rack.loadingUnracked')} />}
							>
								<Show
									when={unrackedDevices().length > 0}
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
										columns={unrackedColumns}
									/>
								</Show>
							</Show>
						</section>

						<AttachmentsSection id="rack-attachments" images={images} />
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
						<Show when={FEATURES.schematics}>
							<div class="rack-elev-toolbar">
								<div
									class="segmented"
									role="radiogroup"
									aria-label={t('elevation.display')}
								>
									<For each={DISPLAYS}>
										{(value: ElevationDisplay): JSX.Element => (
											<label class="segmented-option">
												<input
													type="radio"
													name="rack-elevation-display"
													value={value}
													checked={display() === value}
													onChange={() => setDisplay(value)}
												/>
												<span>
													{value === 'images'
														? t('elevation.displayImages')
														: t('elevation.displayLabels')}
												</span>
											</label>
										)}
									</For>
								</div>
							</div>
						</Show>
						<Show
							when={elevation()}
							fallback={<Loading message={t('rack.loadingElevation')} />}
						>
							<RackElevation
								faceplates={faceplatePorts()}
								units={elevation()?.units ?? []}
								shelves={elevation()?.shelves ?? []}
								selected_u={pendingU()}
								selected_face={face()}
								on_select_u={pickU}
								on_select_device={openDeviceSelector}
								on_add_device={installDevice}
								on_add_shelf={installShelf}
								on_move_device={(
									device: ElevationDeviceRef,
									position_u: number,
									targetFace: RackFace | null,
								): void => void moveDevice(device, position_u, targetFace)}
								on_swap_devices={(
									device: ElevationDeviceRef,
									other: ElevationDeviceRef,
								): void => void swapDevices(device, other)}
								readonly={!can('edit')}
								shelf_actions={{
									on_add_shelf_device: addShelfDevice,
									on_select_shelf_device: openShelfDeviceSelector,
									on_remove_shelf_device: (
										device: ElevationShelfDeviceRef,
									): void => void removeFromShelf(device),
								}}
							/>
						</Show>
						<Show when={selectingDevice()}>
							<RackDeviceDialog
								title={
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
								tenant_id={rack()?.tenant_id}
								mountable={targetShelf() === null}
								get_note={placementNote}
								on_select={placeDevice}
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
