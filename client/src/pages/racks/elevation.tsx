import type {
	DeviceFace,
	ElevationDeviceRef,
	ElevationShelfDeviceRef,
	ElevationShelfRef,
	ElevationUnit,
} from 'shared/src/types'
import { For, type JSX, Show } from 'solid-js'
import { t } from '../../i18n'
import { deviceStatusLabel, faceLabel } from '../../i18n/labels'

export type RackFace = DeviceFace

const FACES: RackFace[] = ['front', 'rear']

/** `HE12` / `U12` style unit reference. */
function u_label(u: number | undefined): string {
	return t('common.unitPosition', { u: u ?? '' })
}

/** Display name of a shelf, falling back to the generic noun. */
function shelf_name(shelf: ElevationShelfRef | undefined): string {
	return shelf?.name || t('elevation.unnamedShelf')
}

/** Inclusive U span helper. */
interface USpan {
	first: number
	last: number
}

function covers(span: USpan, u: number): boolean {
	return u >= span.first && u <= span.last
}

/** Full footprint of a shelf: mount plus reserved height. */
function shelf_footprint(shelf: ElevationShelfRef): USpan {
	return {
		first: shelf.position_u,
		last: shelf.position_u + shelf.mount_height + shelf.reserved_height - 1,
	}
}

/**
 * Blocked U range of a shelf (mirrors `shelfBlockedRange` on the server):
 * the mount span counts unless `mount_usable` is set; the reserved span
 * always counts.
 */
function shelf_blocked(shelf: ElevationShelfRef): USpan | null {
	if (shelf.mount_usable) {
		if (shelf.reserved_height <= 0) {
			return null
		}
		return {
			first: shelf.position_u + shelf.mount_height,
			last: shelf.position_u + shelf.mount_height + shelf.reserved_height - 1,
		}
	}
	return shelf_footprint(shelf)
}

/** Mount hardware span of a shelf. */
function shelf_mount(shelf: ElevationShelfRef): USpan {
	return { first: shelf.position_u, last: shelf.position_u + shelf.mount_height - 1 }
}

/** Whether a shelf renders on this face (half-depth shelves only on their own). */
function shelf_on_face(shelf: ElevationShelfRef, face: RackFace): boolean {
	return shelf.face === null || shelf.face === face || shelf.is_full_depth
}

/**
 * Allocate the two visual shelf sections in proportion to their HE counts.
 * A block that only spans the reserve (mount rows render on their own) is
 * a single section.
 */
function shelf_display_rows(shelf: ElevationShelfRef, plate: boolean): string {
	if (!plate) {
		return 'minmax(0, 1fr)'
	}
	if (shelf.reserved_height > 0) {
		return `minmax(0, ${shelf.reserved_height}fr) minmax(0, ${shelf.mount_height}fr)`
	}
	return `minmax(0, ${shelf.mount_height}fr)`
}

type RowKind = 'free' | 'device'

/** Devices occupying a unit on either face. */
function unit_devices(unit: ElevationUnit): ElevationDeviceRef[] {
	return unit.devices ?? (unit.device ? [unit.device] : [])
}

function device_for_face(unit: ElevationUnit, face: RackFace): ElevationDeviceRef | undefined {
	const devices = unit_devices(unit)
	return devices.find((device) => device.face === face || device.face === null) ?? devices[0]
}

function row_kind(unit: ElevationUnit, face: RackFace): RowKind {
	const device = device_for_face(unit, face)
	if (!device) {
		return 'free'
	}
	return device.face === null || device.face === face || device.is_full_depth ? 'device' : 'free'
}

/** True when `face` shows the back side of a full-depth device. */
function is_rear_view(device: ElevationDeviceRef, face: RackFace): boolean {
	return device.face !== null && device.face !== face
}

/** First shelf blocking this unit on the given face. */
function shelf_for_face(unit: ElevationUnit, face: RackFace): ElevationShelfRef | undefined {
	const shelves = unit.shelves ?? (unit.shelf ? [unit.shelf] : [])
	return shelves.find((shelf) => shelf_on_face(shelf, face))
}

/**
 * Rendered block span of a shelf on one face. An usable mount renders like
 * any other shelf (reserve plus plate over the full footprint) while its
 * mount rows are empty; once a device is U-mounted there (or the shelf
 * belongs to the opposite face) the block shrinks to the blocked reserve so
 * the mount rows can show what occupies them.
 */
function shelf_block_span(
	shelf: ElevationShelfRef,
	units: ElevationUnit[],
	face: RackFace,
): USpan | null {
	if (!shelf.mount_usable) {
		return shelf_footprint(shelf)
	}
	const mount = shelf_mount(shelf)
	const mount_taken =
		!shelf_on_face(shelf, face) ||
		units.some((unit) => covers(mount, unit.u) && unit_devices(unit).length > 0)
	return mount_taken ? shelf_blocked(shelf) : shelf_footprint(shelf)
}

type Segment =
	| { kind: 'free'; u: number }
	| {
			kind: 'device'
			device: ElevationDeviceRef
			rows: number
			shelf?: ElevationShelfRef
			/** Back side of a full-depth device mounted on the other face. */
			rear: boolean
	  }
	| {
			kind: 'shelf'
			shelf: ElevationShelfRef
			first_u: number
			last_u: number
			rows: number
			/** True when the block covers the mount hardware (plate row shown). */
			plate: boolean
	  }
	| {
			kind: 'mount'
			shelf: ElevationShelfRef
			u: number
			/** Topmost row of a shelf without reserve: carries the shelf label. */
			label: boolean
	  }

/**
 * Groups top-down units into block segments for one face. Shelf blocks span
 * their full footprint (see `shelf_block_span` for usable mounts that are
 * taken); a leftover free row of a taken usable mount renders as a mount
 * bar.
 */
function segments_for_face(
	units: ElevationUnit[],
	shelves: ElevationShelfRef[],
	face: RackFace,
): Segment[] {
	const segments: Segment[] = []
	let i = 0
	while (i < units.length) {
		const unit = units[i] as ElevationUnit
		const candidates = [
			shelf_for_face(unit, face),
			...shelves.filter((s) => s.mount_usable && shelf_on_face(s, face)),
		]
		let shelf: ElevationShelfRef | undefined
		let blocked: USpan | null = null
		for (const candidate of candidates) {
			const span = candidate ? shelf_block_span(candidate, units, face) : null
			if (candidate && span && covers(span, unit.u)) {
				shelf = candidate
				blocked = span
				break
			}
		}
		if (shelf && blocked) {
			// Consume every unit inside this shelf's blocked range (units are
			// contiguous, one per U) as one block.
			let rows = 0
			while (
				i + rows < units.length &&
				covers(blocked, (units[i + rows] as ElevationUnit).u)
			) {
				rows += 1
			}
			segments.push({
				kind: 'shelf',
				shelf,
				first_u: blocked.first,
				last_u: blocked.last,
				rows,
				plate: blocked.first === shelf.position_u,
			})
			i += rows
			continue
		}
		const kind = row_kind(unit, face)
		const device = device_for_face(unit, face)
		if (kind === 'free' || !device) {
			// An usable shelf mount without a device renders as a thin bar.
			const mount = shelves.find(
				(s) => s.mount_usable && shelf_on_face(s, face) && covers(shelf_mount(s), unit.u),
			)
			if (mount) {
				segments.push({
					kind: 'mount',
					shelf: mount,
					u: unit.u,
					label: mount.reserved_height === 0 && unit.u === shelf_mount(mount).last,
				})
				i += 1
				continue
			}
			segments.push({ kind: 'free', u: unit.u })
			i += 1
			continue
		}
		const deviceShelf = shelves.find(
			(s) =>
				s.mount_usable &&
				shelf_on_face(s, face) &&
				covers(shelf_mount(s), device.position_u),
		)
		segments.push({
			kind: 'device',
			device,
			rows: device.u_height,
			shelf: deviceShelf,
			rear: is_rear_view(device, face),
		})
		i += device.u_height
	}
	return segments
}

/** Gutter cells for the U range a block spans (top-down from `topU`). */
function BlockGutters(props: { topU: number; row: number; rows: number }): JSX.Element {
	return (
		<For each={Array.from({ length: props.rows }, (_, k) => props.topU - k)}>
			{(u: number, k: () => number): JSX.Element => (
				<li
					class="rack-u-gutter-row"
					style={{ 'grid-row': `${props.row + k()}`, 'grid-column': '1' }}
					aria-hidden="true"
				>
					<span class="rack-u-gutter">{u}</span>
				</li>
			)}
		</For>
	)
}

/** Callbacks for placing devices on / taking them off a shelf. */
export interface ShelfDeviceActions {
	on_add_shelf_device: (shelf: ElevationShelfRef) => void
	on_select_shelf_device: (shelf: ElevationShelfRef) => void
	on_remove_shelf_device: (device: ElevationShelfDeviceRef, shelf: ElevationShelfRef) => void
}

/**
 * Devices sitting on a shelf as removable chips, plus a hover action to select
 * an existing device to put on it.
 */
function ShelfDevices(props: {
	shelf: ElevationShelfRef
	actions: ShelfDeviceActions
	/** Only the chips; the host row renders its own actions. */
	chips_only?: boolean
	/** Extra hover actions (U-mounting into an usable mount). */
	mount_actions?: JSX.Element
	/** Hide the remove / add / select actions. */
	readonly?: boolean
}): JSX.Element {
	const label = (): string => shelf_name(props.shelf)
	return (
		<ul
			class="rack-shelf-devices"
			aria-label={t('elevation.devicesOnShelf', { name: label() })}
		>
			<For each={props.shelf.devices}>
				{(device: ElevationShelfDeviceRef): JSX.Element => (
					<li
						class="rack-shelf-device"
						title={`${device.name} (${device.device_type_model})`}
					>
						<a href={`/devices/${device.id}`} class="rack-shelf-device-link">
							{device.name}
						</a>
						<Show when={props.readonly !== true}>
							<button
								type="button"
								class="rack-shelf-device-remove"
								aria-label={t('elevation.removeFromShelf', { name: device.name })}
								title={t('elevation.removeFromShelfTitle', { name: device.name })}
								onClick={() =>
									props.actions.on_remove_shelf_device(device, props.shelf)
								}
							>
								×
							</button>
						</Show>
					</li>
				)}
			</For>
			<Show when={!props.chips_only && props.readonly !== true}>
				<li class="rack-shelf-device-actions">
					<button
						type="button"
						class="rack-free-btn"
						aria-label={t('elevation.addDeviceToShelf')}
						title={t('elevation.addDeviceToShelfTitle', { name: label() })}
						onClick={() => props.actions.on_add_shelf_device(props.shelf)}
					>
						{t('elevation.addDeviceShort')}
					</button>
					<button
						type="button"
						class="rack-free-btn"
						aria-label={t('elevation.selectDeviceForShelf')}
						title={t('elevation.selectDeviceForShelfTitle', { name: label() })}
						onClick={() => props.actions.on_select_shelf_device(props.shelf)}
					>
						{t('elevation.select')}
					</button>
					{props.mount_actions}
				</li>
			</Show>
		</ul>
	)
}

/** Callbacks and state of `RackElevation`, shared by its row components. */
interface ElevationProps {
	units: ElevationUnit[]
	shelves: ElevationShelfRef[]
	selected_u: number | null
	selected_face: RackFace | null
	on_select_u: (u: number, face: RackFace) => void
	on_select_device: (u: number, face: RackFace) => void
	on_add_device: (u: number, face: RackFace) => void
	on_add_shelf: (u: number, face: RackFace) => void
	shelf_actions: ShelfDeviceActions
	/** Read-only session: no add / select / remove actions. */
	readonly?: boolean
}

/** Props of one segment row: the elevation, its face and the grid row. */
interface RowProps<S extends Segment['kind']> {
	elevation: ElevationProps
	face: RackFace
	segment: Extract<Segment, { kind: S }>
	row: number
}

/** Hover action button of a free or mount row; `text` defaults to the label. */
function RowAction(props: {
	label: string
	text?: string
	title: string
	onClick: () => void
}): JSX.Element {
	return (
		<button
			type="button"
			class="rack-free-btn"
			aria-label={props.label}
			title={props.title}
			onClick={() => props.onClick()}
		>
			{props.text ?? props.label}
		</button>
	)
}

/** Grid placement of a block in the device column. */
function blockStyle(row: number, rows: number): JSX.CSSProperties {
	return { 'grid-row': rows === 1 ? `${row}` : `${row} / span ${rows}`, 'grid-column': '2' }
}

/** An empty unit: select, add a device or add a shelf there. */
function FreeRow(props: RowProps<'free'>): JSX.Element {
	const u = (): number => props.segment.u
	const at = (): { unit: string; face: string } => ({
		unit: u_label(u()),
		face: faceLabel(props.face),
	})
	const e = (): ElevationProps => props.elevation
	return (
		<>
			<BlockGutters topU={u()} row={props.row} rows={1} />
			<li
				class="rack-u rack-u-free"
				classList={{
					'rack-u-selected': e().selected_u === u() && e().selected_face === props.face,
				}}
				data-u={u()}
				style={blockStyle(props.row, 1)}
			>
				<span class="rack-u-body">
					<Show when={e().readonly !== true}>
						<div class="rack-free-actions">
							<RowAction
								label={t('elevation.selectDevice')}
								title={t('elevation.selectDeviceAt', at())}
								onClick={() => {
									e().on_select_u(u(), props.face)
									e().on_select_device(u(), props.face)
								}}
							/>
							<RowAction
								label={t('elevation.addDevice')}
								title={t('elevation.addDeviceAt', at())}
								onClick={() => e().on_add_device(u(), props.face)}
							/>
							<RowAction
								label={t('elevation.addShelf')}
								title={t('elevation.addShelfAt', at())}
								onClick={() => e().on_add_shelf(u(), props.face)}
							/>
						</div>
					</Show>
				</span>
			</li>
		</>
	)
}

/** A free unit inside an usable shelf mount: U-mount a device or shelve one. */
function MountRow(props: RowProps<'mount'>): JSX.Element {
	const s = (): ElevationShelfRef => props.segment.shelf
	const u = (): number => props.segment.u
	const e = (): ElevationProps => props.elevation
	const at = (): { unit: string; face: string } => ({
		unit: u_label(u()),
		face: faceLabel(props.face),
	})
	return (
		<>
			<BlockGutters topU={u()} row={props.row} rows={1} />
			<li
				class="rack-block rack-u-shelf-mount"
				data-u={u()}
				style={blockStyle(props.row, 1)}
				title={t('elevation.mountFreeTitle', {
					mount: u_label(s().position_u),
					unit: u_label(u()),
				})}
			>
				<Show
					when={props.segment.label}
					fallback={<span class="rack-mount-slot">{t('elevation.mountFree')}</span>}
				>
					<a href={`/shelves/${s().id}/edit`} class="rack-shelf-plate">
						<span class="rack-dev-name">▤ {shelf_name(s())}</span>
						<span class="rack-dev-meta">{t('shelf.mountUsable')}</span>
					</a>
					<ShelfDevices
						shelf={s()}
						readonly={e().readonly}
						actions={e().shelf_actions}
						chips_only
					/>
				</Show>
				<Show when={e().readonly !== true}>
					<div class="rack-mount-actions">
						<RowAction
							label={t('elevation.addChildDevice')}
							text={t('elevation.addDevice')}
							title={t('elevation.addChildDeviceTitle', at())}
							onClick={() => e().on_add_device(u(), props.face)}
						/>
						<RowAction
							label={t('elevation.selectChildDevice')}
							text={t('elevation.selectDevice')}
							title={t('elevation.selectChildDeviceTitle', at())}
							onClick={() => e().on_select_device(u(), props.face)}
						/>
						<RowAction
							label={t('elevation.selectDeviceForShelf')}
							text={t('elevation.onShelf')}
							title={t('elevation.selectDeviceForShelfTitle', {
								name: shelf_name(s()),
							})}
							onClick={() => e().shelf_actions.on_select_shelf_device(s())}
						/>
					</div>
				</Show>
			</li>
		</>
	)
}

/** A shelf over its blocked range: hatched reserve above the mount plate. */
function ShelfBlock(props: RowProps<'shelf'> & { topU: number }): JSX.Element {
	const s = (): ElevationShelfRef => props.segment.shelf
	const e = (): ElevationProps => props.elevation
	const spans = (): { mount: string; mountHeight: number; reserved: number } => ({
		mount: u_label(s().position_u),
		mountHeight: s().mount_height,
		reserved: s().reserved_height,
	})
	const devices = (): JSX.Element => (
		<ShelfDevices shelf={s()} readonly={e().readonly} actions={e().shelf_actions} />
	)
	const reserved = (): string => t('elevation.reserved', { count: s().reserved_height })
	return (
		<>
			<BlockGutters topU={props.topU} row={props.row} rows={props.segment.rows} />
			<li
				class="rack-block rack-u-shelf"
				style={{
					...blockStyle(props.row, props.segment.rows),
					'grid-template-rows': shelf_display_rows(s(), props.segment.plate),
				}}
				aria-label={t('elevation.shelfBlock', {
					mount: u_label(s().position_u),
					first: u_label(props.segment.first_u),
					last: u_label(props.segment.last_u),
				})}
			>
				<Show
					when={props.segment.plate}
					fallback={
						<div class="rack-shelf-clearance">
							<a
								href={`/shelves/${s().id}/edit`}
								class="rack-shelf-clearance-link"
								title={t('elevation.clearanceTitle', spans())}
							>
								<span class="rack-dev-name">▤ {shelf_name(s())}</span>
								<span class="rack-shelf-caption">{reserved()}</span>
							</a>
							{devices()}
						</div>
					}
				>
					<Show when={s().reserved_height > 0}>
						<div class="rack-shelf-clearance">
							<span class="rack-shelf-caption">{reserved()}</span>
							{devices()}
						</div>
					</Show>
					<div class="rack-shelf-plate-row">
						<a
							href={`/shelves/${s().id}/edit`}
							class="rack-shelf-plate"
							title={t(
								s().reserved_height > 0
									? 'elevation.plateTitleReserved'
									: 'elevation.plateTitle',
								spans(),
							)}
						>
							<span class="rack-dev-name">▤ {shelf_name(s())}</span>
							<Show when={s().mount_usable}>
								<span class="rack-dev-meta">{t('shelf.mountUsable')}</span>
							</Show>
						</a>
						<Show when={s().reserved_height === 0}>{devices()}</Show>
					</div>
				</Show>
			</li>
		</>
	)
}

/** A device spanning its U height, linking to its detail page. */
function DeviceBlock(props: RowProps<'device'> & { topU: number }): JSX.Element {
	const device = (): ElevationDeviceRef => props.segment.device
	const status = (): string => device().status ?? 'active'
	const shelfUnit = (): string => u_label(props.segment.shelf?.position_u)
	return (
		<>
			<BlockGutters topU={props.topU} row={props.row} rows={props.segment.rows} />
			<li
				class="rack-block rack-u-device"
				classList={{ 'rack-u-device-rear': props.segment.rear }}
				style={blockStyle(props.row, props.segment.rows)}
			>
				<a
					href={`/devices/${device().id}`}
					class="rack-dev"
					title={t('elevation.deviceTitle', {
						name: device().name,
						model: device().device_type_model,
						height: device().u_height,
					})}
				>
					<span class="rack-dev-name">{device().name}</span>
					<span class="rack-dev-meta">{device().device_type_model}</span>
					<Show when={props.segment.rear}>
						<span class="visually-hidden">{t('elevation.rearSide')}</span>
					</Show>
					<Show when={props.segment.shelf}>
						<span
							class="rack-child-shelf"
							title={t('elevation.onShelfTitle', {
								name: props.segment.shelf?.name || '',
								unit: shelfUnit(),
							})}
						>
							▤
							<span class="visually-hidden">
								{t('elevation.shelfUnit', { unit: shelfUnit() })}
							</span>
						</span>
					</Show>
					<Show when={status() !== 'active'}>
						<span class={`badge badge-${device().status}`}>
							{deviceStatusLabel(status())}
						</span>
					</Show>
				</a>
			</li>
		</>
	)
}

/** One face of the rack: the unit grid with its segments. */
function ElevationFace(props: { elevation: ElevationProps; face: RackFace }): JSX.Element {
	const units = (): ElevationUnit[] => props.elevation.units
	const topU = (): number => (units().length > 0 ? (units()[0] as ElevationUnit).u : 0)
	const placed = (): { segment: Segment; row: number }[] => {
		let cursor = 1
		return segments_for_face(units(), props.elevation.shelves, props.face).map((segment) => {
			const row = cursor
			cursor += segment.kind === 'free' || segment.kind === 'mount' ? 1 : segment.rows
			return { segment, row }
		})
	}

	function render(placement: { segment: Segment; row: number }): JSX.Element {
		const { segment, row } = placement
		const common = { elevation: props.elevation, face: props.face, row }
		// Blocks count their gutter down from the U at their top row.
		const blockTop = topU() - (row - 1)
		switch (segment.kind) {
			case 'free':
				return <FreeRow {...common} segment={segment} />
			case 'mount':
				return <MountRow {...common} segment={segment} />
			case 'shelf':
				return <ShelfBlock {...common} segment={segment} topU={blockTop} />
			case 'device':
				return <DeviceBlock {...common} segment={segment} topU={blockTop} />
		}
	}

	return (
		<section aria-label={t('elevation.section', { face: faceLabel(props.face) })}>
			<h4 class="rack-face-title">{faceLabel(props.face)}</h4>
			<ol
				class="rack-elev"
				style={{ 'grid-template-rows': `repeat(${units().length}, var(--rack-row-h))` }}
			>
				<For each={placed()}>{render}</For>
			</ol>
		</section>
	)
}

/**
 * NetBox-like visual rack elevation with front and rear side by side.
 * Block layout: one gutter cell per U, devices span their U height, shelves
 * span their blocked range (mount plate plus hatched reserve above).
 */
export function RackElevation(props: ElevationProps): JSX.Element {
	return (
		<div class="rack-elev-dual" data-testid="rack-elevation">
			<For each={FACES}>
				{(face: RackFace): JSX.Element => <ElevationFace elevation={props} face={face} />}
			</For>
		</div>
	)
}
