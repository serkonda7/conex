import type {
	DeviceFace,
	ElevationDeviceRef,
	ElevationShelfDeviceRef,
	ElevationShelfRef,
	ElevationUnit,
} from 'shared/src/types'
import { For, type JSX, Show } from 'solid-js'
import { t } from '../i18n'
import { deviceStatusLabel, faceLabel } from '../i18n/labels'
import { goTo } from '../router'

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

type RowKind = 'free' | 'device' | 'ghost'

function device_for_face(unit: ElevationUnit, face: RackFace): ElevationDeviceRef | undefined {
	const devices = unit.devices ?? (unit.device ? [unit.device] : [])
	return devices.find((device) => device.face === face || device.face === null) ?? devices[0]
}

function row_kind(unit: ElevationUnit, face: RackFace): RowKind {
	const device = device_for_face(unit, face)
	if (!device) {
		return 'free'
	}
	return device.face === null || device.face === face || device.is_full_depth ? 'device' : 'ghost'
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
		units.some((unit) => covers(mount, unit.u) && row_kind(unit, face) !== 'free')
	return mount_taken ? shelf_blocked(shelf) : shelf_footprint(shelf)
}

type Segment =
	| { kind: 'free'; u: number }
	| { kind: 'device'; device: ElevationDeviceRef; rows: number; shelf?: ElevationShelfRef }
	| { kind: 'ghost'; device: ElevationDeviceRef; rows: number }
	| {
			kind: 'shelf'
			shelf: ElevationShelfRef
			first_u: number
			last_u: number
			rows: number
			ghost: boolean
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
				ghost: !(shelf.face === null || shelf.face === face || shelf.is_full_depth),
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
		if (kind === 'ghost') {
			// Consecutive ghost rows of the same device form one block.
			let rows = 1
			while (
				i + rows < units.length &&
				row_kind(units[i + rows] as ElevationUnit, face) === 'ghost' &&
				device_for_face(units[i + rows] as ElevationUnit, face)?.id === device.id
			) {
				rows += 1
			}
			segments.push({ kind: 'ghost', device, rows })
			i += rows
			continue
		}
		const deviceShelf = shelves.find(
			(s) =>
				s.mount_usable &&
				shelf_on_face(s, face) &&
				covers(shelf_mount(s), device.position_u),
		)
		segments.push({ kind: 'device', device, rows: device.u_height, shelf: deviceShelf })
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
						<a
							href={`/devices/${device.id}`}
							class="rack-shelf-device-link"
							onClick={(e: MouseEvent): void => goTo(e, `/devices/${device.id}`)}
						>
							{device.name}
						</a>
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
					</li>
				)}
			</For>
			<Show when={!props.chips_only}>
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

/**
 * NetBox-like visual rack elevation with front and rear side by side.
 * Block layout: one gutter cell per U, devices span their U height, shelves
 * span their blocked range (mount plate plus hatched reserve above).
 */
export function RackElevation(props: {
	units: ElevationUnit[]
	shelves: ElevationShelfRef[]
	selected_u: number | null
	selected_face: RackFace | null
	on_select_u: (u: number, face: RackFace) => void
	on_select_device: (u: number, face: RackFace) => void
	on_add_device: (u: number, face: RackFace) => void
	on_add_shelf: (u: number, face: RackFace) => void
	shelf_actions: ShelfDeviceActions
}): JSX.Element {
	const topU = (): number => (props.units.length > 0 ? (props.units[0] as ElevationUnit).u : 0)
	return (
		<div class="rack-elev-dual" data-testid="rack-elevation">
			<For each={FACES}>
				{(face: RackFace): JSX.Element => {
					const placed = (): { segment: Segment; row: number }[] => {
						let cursor = 1
						return segments_for_face(props.units, props.shelves, face).map(
							(segment) => {
								const start = cursor
								cursor +=
									segment.kind === 'free' || segment.kind === 'mount'
										? 1
										: segment.rows
								return { segment, row: start }
							},
						)
					}
					return (
						<section aria-label={t('elevation.section', { face: faceLabel(face) })}>
							<h4 class="rack-face-title">{faceLabel(face)}</h4>
							<ol
								class="rack-elev"
								style={{
									'grid-template-rows': `repeat(${props.units.length}, var(--rack-row-h))`,
								}}
							>
								<For each={placed()}>
									{({
										segment,
										row,
									}: {
										segment: Segment
										row: number
									}): JSX.Element => {
										if (segment.kind === 'free') {
											return (
												<>
													<li
														class="rack-u-gutter-row"
														style={{
															'grid-row': `${row}`,
															'grid-column': '1',
														}}
														aria-hidden="true"
													>
														<span class="rack-u-gutter">
															{segment.u}
														</span>
													</li>
													<li
														class="rack-u rack-u-free"
														classList={{
															'rack-u-selected':
																props.selected_u === segment.u &&
																props.selected_face === face,
														}}
														data-u={segment.u}
														style={{
															'grid-row': `${row}`,
															'grid-column': '2',
														}}
													>
														<span class="rack-u-body">
															<div class="rack-free-actions">
																<button
																	type="button"
																	class="rack-free-btn"
																	aria-label={t(
																		'elevation.selectDevice',
																	)}
																	title={t(
																		'elevation.selectDeviceAt',
																		{
																			unit: u_label(
																				segment.u,
																			),
																			face: faceLabel(face),
																		},
																	)}
																	onClick={() => {
																		props.on_select_u(
																			segment.u,
																			face,
																		)
																		props.on_select_device(
																			segment.u,
																			face,
																		)
																	}}
																>
																	{t('elevation.selectDevice')}
																</button>
																<button
																	type="button"
																	class="rack-free-btn"
																	aria-label={t(
																		'elevation.addDevice',
																	)}
																	title={t(
																		'elevation.addDeviceAt',
																		{
																			unit: u_label(
																				segment.u,
																			),
																			face: faceLabel(face),
																		},
																	)}
																	onClick={() =>
																		props.on_add_device(
																			segment.u,
																			face,
																		)
																	}
																>
																	{t('elevation.addDevice')}
																</button>
																<button
																	type="button"
																	class="rack-free-btn"
																	aria-label={t(
																		'elevation.addShelf',
																	)}
																	title={t(
																		'elevation.addShelfAt',
																		{
																			unit: u_label(
																				segment.u,
																			),
																			face: faceLabel(face),
																		},
																	)}
																	onClick={() =>
																		props.on_add_shelf(
																			segment.u,
																			face,
																		)
																	}
																>
																	{t('elevation.addShelf')}
																</button>
															</div>
														</span>
													</li>
												</>
											)
										}
										if (segment.kind === 'mount') {
											const s = segment.shelf
											return (
												<>
													<BlockGutters
														topU={segment.u}
														row={row}
														rows={1}
													/>
													<li
														class="rack-block rack-u-shelf-mount"
														data-u={segment.u}
														style={{
															'grid-row': `${row}`,
															'grid-column': '2',
														}}
														title={t('elevation.mountFreeTitle', {
															mount: u_label(s.position_u),
															unit: u_label(segment.u),
														})}
													>
														<Show
															when={segment.label}
															fallback={
																<span class="rack-mount-slot">
																	{t('elevation.mountFree')}
																</span>
															}
														>
															<a
																href={`/shelves/${s.id}/edit`}
																class="rack-shelf-plate"
																onClick={(e: MouseEvent): void =>
																	goTo(e, `/shelves/${s.id}/edit`)
																}
															>
																<span class="rack-dev-name">
																	▤ {shelf_name(s)}
																</span>
																<span class="rack-dev-meta">
																	{t('shelf.mountUsable')}
																</span>
															</a>
															<ShelfDevices
																shelf={s}
																actions={props.shelf_actions}
																chips_only
															/>
														</Show>
														<div class="rack-mount-actions">
															<button
																type="button"
																class="rack-free-btn"
																aria-label={t(
																	'elevation.addChildDevice',
																)}
																title={t(
																	'elevation.addChildDeviceTitle',
																	{
																		unit: u_label(segment.u),
																		face: faceLabel(face),
																	},
																)}
																onClick={() =>
																	props.on_add_device(
																		segment.u,
																		face,
																	)
																}
															>
																{t('elevation.addDevice')}
															</button>
															<button
																type="button"
																class="rack-free-btn"
																aria-label={t(
																	'elevation.selectChildDevice',
																)}
																title={t(
																	'elevation.selectChildDeviceTitle',
																	{
																		unit: u_label(segment.u),
																		face: faceLabel(face),
																	},
																)}
																onClick={() =>
																	props.on_select_device(
																		segment.u,
																		face,
																	)
																}
															>
																{t('elevation.selectDevice')}
															</button>
															<button
																type="button"
																class="rack-free-btn"
																aria-label={t(
																	'elevation.selectDeviceForShelf',
																)}
																title={t(
																	'elevation.selectDeviceForShelfTitle',
																	{
																		name: shelf_name(s),
																	},
																)}
																onClick={() =>
																	props.shelf_actions.on_select_shelf_device(
																		s,
																	)
																}
															>
																{t('elevation.onShelf')}
															</button>
														</div>
													</li>
												</>
											)
										}
										if (segment.kind === 'shelf') {
											const s = segment.shelf
											return (
												<>
													<BlockGutters
														topU={topU() - (row - 1)}
														row={row}
														rows={segment.rows}
													/>
													<li
														class="rack-block rack-u-shelf"
														classList={{
															'rack-u-ghost': segment.ghost,
														}}
														style={{
															'grid-row': `${row} / span ${segment.rows}`,
															'grid-column': '2',
															'grid-template-rows':
																shelf_display_rows(
																	s,
																	segment.plate,
																),
														}}
														aria-label={t('elevation.shelfBlock', {
															mount: u_label(s.position_u),
															first: u_label(segment.first_u),
															last: u_label(segment.last_u),
														})}
													>
														<Show
															when={!segment.ghost}
															fallback={
																<span class="rack-ghost">
																	<span class="rack-dev-name">
																		◧ {shelf_name(s)}
																	</span>
																	<span class="rack-dev-meta">
																		{t(
																			'elevation.oppositeFace',
																		)}
																	</span>
																</span>
															}
														>
															<Show
																when={segment.plate}
																fallback={
																	<div class="rack-shelf-clearance">
																		<a
																			href={`/shelves/${s.id}/edit`}
																			class="rack-shelf-clearance-link"
																			onClick={(
																				e: MouseEvent,
																			): void =>
																				goTo(
																					e,
																					`/shelves/${s.id}/edit`,
																				)
																			}
																			title={t(
																				'elevation.clearanceTitle',
																				{
																					mount: u_label(
																						s.position_u,
																					),
																					mountHeight:
																						s.mount_height,
																					reserved:
																						s.reserved_height,
																				},
																			)}
																		>
																			<span class="rack-dev-name">
																				▤ {shelf_name(s)}
																			</span>
																			<span class="rack-shelf-caption">
																				{t(
																					'elevation.reserved',
																					{
																						count: s.reserved_height,
																					},
																				)}
																			</span>
																		</a>
																		<ShelfDevices
																			shelf={s}
																			actions={
																				props.shelf_actions
																			}
																		/>
																	</div>
																}
															>
																<Show when={s.reserved_height > 0}>
																	<div class="rack-shelf-clearance">
																		<span class="rack-shelf-caption">
																			{t(
																				'elevation.reserved',
																				{
																					count: s.reserved_height,
																				},
																			)}
																		</span>
																		<ShelfDevices
																			shelf={s}
																			actions={
																				props.shelf_actions
																			}
																		/>
																	</div>
																</Show>
																<div class="rack-shelf-plate-row">
																	<a
																		href={`/shelves/${s.id}/edit`}
																		class="rack-shelf-plate"
																		onClick={(
																			e: MouseEvent,
																		): void =>
																			goTo(
																				e,
																				`/shelves/${s.id}/edit`,
																			)
																		}
																		title={t(
																			s.reserved_height > 0
																				? 'elevation.plateTitleReserved'
																				: 'elevation.plateTitle',
																			{
																				mount: u_label(
																					s.position_u,
																				),
																				mountHeight:
																					s.mount_height,
																				reserved:
																					s.reserved_height,
																			},
																		)}
																	>
																		<span class="rack-dev-name">
																			▤ {shelf_name(s)}
																		</span>
																		<Show when={s.mount_usable}>
																			<span class="rack-dev-meta">
																				{t(
																					'shelf.mountUsable',
																				)}
																			</span>
																		</Show>
																	</a>
																	<Show
																		when={
																			s.reserved_height === 0
																		}
																	>
																		<ShelfDevices
																			shelf={s}
																			actions={
																				props.shelf_actions
																			}
																		/>
																	</Show>
																</div>
															</Show>
														</Show>
													</li>
												</>
											)
										}
										if (segment.kind === 'ghost') {
											return (
												<>
													<BlockGutters
														topU={topU() - (row - 1)}
														row={row}
														rows={segment.rows}
													/>
													<li
														class="rack-block rack-u-ghost"
														style={{
															'grid-row': `${row} / span ${segment.rows}`,
															'grid-column': '2',
														}}
													>
														<span class="rack-ghost">
															<span class="rack-dev-name">
																◧ {segment.device.name}
															</span>
															<span class="rack-dev-meta">
																{t('elevation.oppositeFace')}
															</span>
														</span>
													</li>
												</>
											)
										}
										return (
											<>
												<BlockGutters
													topU={topU() - (row - 1)}
													row={row}
													rows={segment.rows}
												/>
												<li
													class="rack-block rack-u-device"
													style={{
														'grid-row': `${row} / span ${segment.rows}`,
														'grid-column': '2',
													}}
												>
													<a
														href={`/devices/${segment.device.id}`}
														class="rack-dev"
														onClick={(e: MouseEvent): void =>
															goTo(e, `/devices/${segment.device.id}`)
														}
														title={t('elevation.deviceTitle', {
															name: segment.device.name,
															model: segment.device.device_type_model,
															height: segment.device.u_height,
														})}
													>
														<span class="rack-dev-name">
															{segment.device.name}
														</span>
														<span class="rack-dev-meta">
															{segment.device.device_type_model}
														</span>
														<Show when={segment.shelf}>
															<span
																class="rack-child-shelf"
																title={t('elevation.onShelfTitle', {
																	name: segment.shelf?.name || '',
																	unit: u_label(
																		segment.shelf?.position_u,
																	),
																})}
															>
																▤
																<span class="visually-hidden">
																	{t('elevation.shelfUnit', {
																		unit: u_label(
																			segment.shelf
																				?.position_u,
																		),
																	})}
																</span>
															</span>
														</Show>
														<Show
															when={
																(segment.device.status ??
																	'active') !== 'active'
															}
														>
															<span
																class={`badge badge-${segment.device.status}`}
															>
																{deviceStatusLabel(
																	segment.device.status ??
																		'active',
																)}
															</span>
														</Show>
													</a>
												</li>
											</>
										)
									}}
								</For>
							</ol>
						</section>
					)
				}}
			</For>
		</div>
	)
}
