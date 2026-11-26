import { shelfBlockedRange } from 'shared/src/shelves'
import type {
	DeviceFace,
	ElevationDeviceRef,
	ElevationShelfDeviceRef,
	ElevationShelfRef,
	ElevationUnit,
} from 'shared/src/types'
import { type Accessor, createSignal, For, type JSX, Show } from 'solid-js'
import { Faceplate, type FaceplateViewPort } from '../../components/faceplate'
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

/** Blocked U range of a shelf as an inclusive `{first, last}` span. */
function shelf_blocked(shelf: ElevationShelfRef): USpan | null {
	const blocked = shelfBlockedRange(shelf)
	if (blocked === null) {
		return null
	}
	return { first: blocked.position_u, last: blocked.position_u + blocked.height_u - 1 }
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

/**
 * Whether two mounts may share a U: only half-depth ones on opposite faces
 * (mirrors the server's overlap check).
 */
function mounts_conflict(
	a: { face: RackFace | null; is_full_depth: boolean },
	b: { face: RackFace | null; is_full_depth: boolean },
): boolean {
	return (
		a.face === null ||
		b.face === null ||
		a.face === b.face ||
		a.is_full_depth ||
		b.is_full_depth
	)
}

/**
 * Whether `device` fits at `position_u` on `face`: inside the rack, clear of
 * other devices and of shelf blockers. The server re-validates the move.
 */
function can_place(
	units: ElevationUnit[],
	shelves: ElevationShelfRef[],
	device: ElevationDeviceRef,
	position_u: number,
	face: RackFace | null,
): boolean {
	const span: USpan = { first: position_u, last: position_u + device.u_height - 1 }
	const top = units[0]?.u ?? 0
	if (span.first < 1 || span.last > top) {
		return false
	}
	const moved = { face, is_full_depth: device.is_full_depth }
	const hits = (other: USpan): boolean => other.first <= span.last && span.first <= other.last
	for (const unit of units) {
		if (!covers(span, unit.u)) {
			continue
		}
		for (const other of unit_devices(unit)) {
			if (other.id !== device.id && mounts_conflict(moved, other)) {
				return false
			}
		}
	}
	return !shelves.some((shelf) => {
		const blocked = shelf_blocked(shelf)
		return blocked !== null && hits(blocked) && mounts_conflict(moved, shelf)
	})
}

/** The device being dragged and where on it it was grabbed. */
interface DragSource {
	device: ElevationDeviceRef
	/** Elevation face the drag started on. */
	face: RackFace
	/** Rows between the device's top U and the grabbed row. */
	grab: number
}

/** Where a drop would put the dragged device. */
type DropTarget =
	| {
			kind: 'move'
			/** Elevation face under the pointer. */
			face: RackFace
			position_u: number
			/** Mount face the device ends up with. */
			device_face: RackFace | null
			valid: boolean
	  }
	| { kind: 'swap'; face: RackFace; other: ElevationDeviceRef }

/** Drag state shared by both faces of one elevation. */
interface DeviceDrag {
	source: Accessor<DragSource | null>
	target: Accessor<DropTarget | null>
	start: (source: DragSource) => void
	over: (target: DropTarget | null) => void
	end: () => void
}

function createDeviceDrag(): DeviceDrag {
	const [source, setSource] = createSignal<DragSource | null>(null)
	const [target, setTarget] = createSignal<DropTarget | null>(null)
	return {
		source,
		target,
		start: (next: DragSource): void => {
			setSource(next)
			setTarget(null)
		},
		over: (next: DropTarget | null): void => {
			setTarget(next)
		},
		end: (): void => {
			setSource(null)
			setTarget(null)
		},
	}
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
				plate: shelf.mount_height > 0 && blocked.first === shelf.position_u,
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
interface ShelfDeviceActions {
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
	/**
	 * Images mode: devices show their symbolic faceplate with these ports
	 * (by device id) instead of name and model.
	 */
	faceplates?: ReadonlyMap<number, readonly FaceplateViewPort[]>
	/**
	 * Drag and drop: moves a device so its bottom U is `position_u` on the
	 * mount face `face`. Without it devices are not draggable.
	 */
	on_move_device?: (device: ElevationDeviceRef, position_u: number, face: RackFace | null) => void
	/** Drop onto another mounted device: the two trade places. */
	on_swap_devices?: (device: ElevationDeviceRef, other: ElevationDeviceRef) => void
}

/** Props of one segment row: the elevation, its face and the grid row. */
interface RowProps<S extends Segment['kind']> {
	elevation: ElevationProps
	drag: DeviceDrag
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
	const movable = (): boolean =>
		props.elevation.readonly !== true && props.elevation.on_move_device !== undefined
	const title = (): string => {
		const base = t('elevation.deviceTitle', {
			name: device().name,
			model: device().device_type_model,
			height: device().u_height,
		})
		return movable() ? `${base}\n${t('elevation.dragHint')}` : base
	}
	const swapTarget = (): boolean => {
		const target = props.drag.target()
		return (
			target?.kind === 'swap' && target.face === props.face && target.other.id === device().id
		)
	}
	function startDrag(e: DragEvent): void {
		const block = e.currentTarget as HTMLElement
		const rect = block.getBoundingClientRect()
		const rowHeight = rect.height / Math.max(1, props.segment.rows)
		const grab = Math.min(
			props.segment.rows - 1,
			Math.max(0, Math.floor((e.clientY - rect.top) / rowHeight)),
		)
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move'
			// Firefox only starts a drag that carries data.
			e.dataTransfer.setData('text/plain', device().name)
			e.dataTransfer.setDragImage(block, e.clientX - rect.left, e.clientY - rect.top)
		}
		props.drag.start({ device: device(), face: props.face, grab })
	}
	return (
		<>
			<BlockGutters topU={props.topU} row={props.row} rows={props.segment.rows} />
			<li
				class="rack-block rack-u-device"
				classList={{
					'rack-u-device-rear': props.segment.rear,
					'rack-u-movable': movable(),
					'rack-u-dragging': props.drag.source()?.device.id === device().id,
					'rack-drop-swap': swapTarget(),
				}}
				style={blockStyle(props.row, props.segment.rows)}
				data-device-id={device().id}
				draggable={movable()}
				onDragStart={startDrag}
				onDragEnd={() => props.drag.end()}
			>
				<Show
					when={props.elevation.faceplates}
					fallback={<DeviceLabel {...props} title={title()} shelfUnit={shelfUnit()} />}
				>
					{(
						faceplates: () => ReadonlyMap<number, readonly FaceplateViewPort[]>,
					): JSX.Element => (
						<a href={`/devices/${device().id}`} class="rack-dev-image" title={title()}>
							<Faceplate
								ports={faceplates().get(device().id) ?? []}
								face={props.segment.rear ? 'rear' : 'front'}
								u_height={device().u_height}
								label={device().name}
								hideLabel
							/>
							<span class="rack-dev-image-name">{device().name}</span>
							<Show when={status() !== 'active'}>
								<span class={`badge badge-${device().status}`}>
									{deviceStatusLabel(status())}
								</span>
							</Show>
						</a>
					)}
				</Show>
			</li>
		</>
	)
}

/** Name, model and markers of a device block in labels mode. */
function DeviceLabel(
	props: RowProps<'device'> & { title: string; shelfUnit: string },
): JSX.Element {
	const device = (): ElevationDeviceRef => props.segment.device
	const status = (): string => device().status ?? 'active'
	const shelfUnit = (): string => props.shelfUnit
	return (
		<a href={`/devices/${device().id}`} class="rack-dev" title={props.title}>
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
				<span class={`badge badge-${device().status}`}>{deviceStatusLabel(status())}</span>
			</Show>
		</a>
	)
}

/** One face of the rack: the unit grid with its segments. */
function ElevationFace(props: {
	elevation: ElevationProps
	drag: DeviceDrag
	face: RackFace
}): JSX.Element {
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
		const common = { elevation: props.elevation, drag: props.drag, face: props.face, row }
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

	/** Mounted device by id, for the block under the pointer. */
	function deviceById(id: number): ElevationDeviceRef | undefined {
		for (const unit of units()) {
			const found = unit_devices(unit).find((device) => device.id === id)
			if (found) {
				return found
			}
		}
		return undefined
	}

	/** What dropping the dragged device at the pointer would do. */
	function dropTarget(e: DragEvent, source: DragSource): DropTarget | null {
		const list = e.currentTarget as HTMLElement
		const block = (e.target as Element | null)?.closest<HTMLElement>('[data-device-id]')
		const other = block ? deviceById(Number(block.dataset.deviceId)) : undefined
		if (other && other.id !== source.device.id) {
			return { kind: 'swap', face: props.face, other }
		}
		const count = units().length
		if (count === 0) {
			return null
		}
		const rect = list.getBoundingClientRect()
		const row = Math.floor(
			((e.clientY - rect.top - list.clientTop) / list.clientHeight) * count,
		)
		const pointerU = topU() - Math.min(count - 1, Math.max(0, row))
		const position_u = pointerU + source.grab - source.device.u_height + 1
		// Within its face column a device keeps its mount face; dropped on the
		// other column it is mounted on that face.
		const device_face = source.face === props.face ? source.device.face : props.face
		return {
			kind: 'move',
			face: props.face,
			position_u,
			device_face,
			valid: can_place(
				units(),
				props.elevation.shelves,
				source.device,
				position_u,
				device_face,
			),
		}
	}

	function onDragOver(e: DragEvent): void {
		const source = props.drag.source()
		if (!source) {
			return
		}
		const target = dropTarget(e, source)
		props.drag.over(target)
		if (target && (target.kind === 'swap' || target.valid)) {
			e.preventDefault()
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move'
			}
		}
	}

	function onDragLeave(e: DragEvent): void {
		// Leaving a child row also bubbles here, and browsers often leave
		// `relatedTarget` empty on drag events: clear only once outside.
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
		const inside =
			e.clientX > rect.left &&
			e.clientX < rect.right &&
			e.clientY > rect.top &&
			e.clientY < rect.bottom
		if (!inside) {
			props.drag.over(null)
		}
	}

	function onDrop(e: DragEvent): void {
		const source = props.drag.source()
		const target = source ? dropTarget(e, source) : null
		props.drag.end()
		if (!source || !target) {
			return
		}
		e.preventDefault()
		if (target.kind === 'swap') {
			props.elevation.on_swap_devices?.(source.device, target.other)
			return
		}
		const unchanged =
			target.position_u === source.device.position_u &&
			target.device_face === source.device.face
		if (target.valid && !unchanged) {
			props.elevation.on_move_device?.(source.device, target.position_u, target.device_face)
		}
	}

	/** Grid rows the move preview covers, clipped to the rack. */
	const preview = (): { row: number; rows: number; valid: boolean } | null => {
		const target = props.drag.target()
		const source = props.drag.source()
		if (!source || target?.kind !== 'move' || target.face !== props.face) {
			return null
		}
		const first = Math.max(1, topU() - (target.position_u + source.device.u_height - 1) + 1)
		const last = Math.min(units().length, topU() - target.position_u + 1)
		return first > last ? null : { row: first, rows: last - first + 1, valid: target.valid }
	}

	return (
		<section
			class="rack-elev-face"
			aria-label={t('elevation.section', { face: faceLabel(props.face) })}
		>
			<h4 class="rack-face-title">{faceLabel(props.face)}</h4>
			<ol
				class="rack-elev"
				classList={{ 'rack-elev-images': props.elevation.faceplates !== undefined }}
				style={{ 'grid-template-rows': `repeat(${units().length}, var(--rack-row-h))` }}
				onDragOver={onDragOver}
				onDragLeave={onDragLeave}
				onDrop={onDrop}
			>
				<For each={placed()}>{render}</For>
				<Show when={preview()}>
					{(at: () => { row: number; rows: number; valid: boolean }): JSX.Element => (
						<li
							class="rack-drop-preview"
							classList={{ 'rack-drop-invalid': !at().valid }}
							style={blockStyle(at().row, at().rows)}
							aria-hidden="true"
						/>
					)}
				</Show>
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
	const drag = createDeviceDrag()
	return (
		<div class="rack-elev-dual" data-testid="rack-elevation">
			<For each={FACES}>
				{(face: RackFace): JSX.Element => (
					<ElevationFace elevation={props} drag={drag} face={face} />
				)}
			</For>
		</div>
	)
}
