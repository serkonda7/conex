/**
 * Pieces shared by the floor plan's view and edit modes: the image stage
 * with the overlay layers on top, its zoom and pan, the marker declutter and
 * the display helpers of areas and markers.
 *
 * Zoom is view-only: the stage is scaled and shifted with a CSS transform,
 * so coordinates stay normalized (0..1) and the editor's pointer mapping
 * (`getBoundingClientRect` of the stage) keeps working. Markers, labels and
 * handles scale back by `--floorplan-inv-zoom` to keep their screen size.
 *
 * A plan with a scale draws a metric grid through its origin (toggled in the
 * layer bar) and shows the pointer's position in meters. The zoom buttons,
 * the grid size and the pointer position sit in a bar below the image.
 *
 * Markers and area labels of the editor take a press for their own drag;
 * while zoomed in, the middle mouse button pans over them too.
 */
import {
	IconBox,
	IconOutlet,
	IconServer,
	IconZoomIn,
	IconZoomOut,
	IconZoomReset,
} from '@tabler/icons-solidjs'
import { type Accessor, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import {
	type AttachmentJson,
	attachment_file_url,
	type FloorplanAreaJson,
	type FloorplanOutletPortJson,
	type FloorplanPlacementJson,
	type FloorplanPortJson,
	type FloorplanScale,
} from '../api/attachments'
import { locale, t, tp } from '../i18n'
import { deviceStatusLabel } from '../i18n/labels'
import { deviceRoleIcon, type IconComponent } from '../lib/icons'
import {
	DEFAULT_GRID_SIZE,
	GRID_SIZES,
	type GridSize,
	gridSize,
	gridVisible,
	markerNamesVisible,
	setGridSize,
	statusColorsVisible,
} from './floorplan_layers'

/** Percent offset of a normalized coordinate, for `left` / `top`. */
export function percent(value: number): string {
	return `${value * 100}%`
}

/** Display name of an area: its label, else its target's name. */
export function areaName(area: FloorplanAreaJson): string {
	return area.label || area.target_name
}

/** Label anchor of an area: its centroid, or the center of its bounding box when it has no area. */
export function areaCenter(area: FloorplanAreaJson): { x: number; y: number } {
	let twiceArea = 0
	let cx = 0
	let cy = 0
	area.points.forEach(([x0, y0], index) => {
		const [x1, y1] = area.points[(index + 1) % area.points.length]
		const cross = x0 * y1 - x1 * y0
		twiceArea += cross
		cx += (x0 + x1) * cross
		cy += (y0 + y1) * cross
	})
	if (Math.abs(twiceArea) > 1e-9) {
		return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) }
	}
	const xs = area.points.map((point) => point[0])
	const ys = area.points.map((point) => point[1])
	return {
		x: (Math.min(...xs) + Math.max(...xs)) / 2,
		y: (Math.min(...ys) + Math.max(...ys)) / 2,
	}
}

/** Rack glyph for racks, a socket for outlets, the role glyph for devices (a generic one without). */
export function markerIcon(
	placement: Pick<FloorplanPlacementJson, 'rack_id' | 'port' | 'role_icon'>,
): IconComponent {
	if (placement.rack_id !== null) {
		return IconBox
	}
	if (placement.port !== null) {
		return IconOutlet
	}
	return deviceRoleIcon(placement.role_icon) ?? IconServer
}

/** True when an outlet is a jack of several ports. */
export function isJack(port: FloorplanPortJson | null): boolean {
	return port !== null && port.ports.length > 1
}

/** Cabling of an outlet: a single port's, or how many ports of a jack are cabled. */
function outletDetail(port: FloorplanPortJson): string {
	if (!isJack(port)) {
		return t(port.connected ? 'floorplan.outletCabled' : 'floorplan.outletFree')
	}
	return t('floorplan.jackCabled', {
		count: port.ports.length,
		cabled: port.ports.filter((p: FloorplanOutletPortJson) => p.connected).length,
	})
}

/** Tooltip of a marker: the name with the device status, "Rack", or the outlet's cabling. */
export function markerTitle(
	placement: Pick<FloorplanPlacementJson, 'name' | 'status' | 'port'>,
): string {
	const detail = placement.port
		? outletDetail(placement.port)
		: placement.status !== null
			? deviceStatusLabel(placement.status)
			: tp('entity.rack', 1)
	return t('floorplan.markerTitle', { name: placement.name, detail })
}

/**
 * Glyph inside a marker: the object's icon, or for a jack one socket per
 * port, each coloured by its cabling.
 */
export function MarkerGlyph(props: {
	placement: Pick<FloorplanPlacementJson, 'rack_id' | 'port' | 'role_icon'>
	size: number
}): JSX.Element {
	return (
		<Show
			when={isJack(props.placement.port) ? (props.placement.port ?? undefined) : undefined}
			fallback={<Dynamic component={markerIcon(props.placement)} size={props.size} />}
		>
			{(port: Accessor<FloorplanPortJson>) => (
				<span class="floorplan-jack-ports">
					<For each={port().ports}>
						{(item: FloorplanOutletPortJson) => (
							<span
								class="floorplan-jack-port"
								classList={{ 'floorplan-jack-port-cabled': item.connected }}
							>
								<IconOutlet size={props.size} />
							</span>
						)}
					</For>
				</span>
			)}
		</Show>
	)
}

/** Name label right of a marker, while names are shown (`markerNamesVisible`). */
export function MarkerName(props: { placement: FloorplanPlacementJson }): JSX.Element {
	return (
		<Show when={markerNamesVisible()}>
			<span class="floorplan-marker-name" aria-hidden="true">
				{props.placement.name}
			</span>
		</Show>
	)
}

/** Colour tone of a device status: in use, not yet in use, out of use. */
function statusTone(status: string): 'active' | 'planned' | 'inactive' {
	if (status === 'active') {
		return 'active'
	}
	return status === 'planned' || status === 'staged' ? 'planned' : 'inactive'
}

/**
 * Marker classes shared by the view and edit modes. The status and cabling
 * classes only colour while the stage shows status colours.
 */
export function markerClasses(placement: FloorplanPlacementJson): Record<string, boolean> {
	const tone =
		placement.status !== null && placement.port === null ? statusTone(placement.status) : null
	return {
		'floorplan-marker-status-active': tone === 'active',
		'floorplan-marker-status-planned': tone === 'planned',
		'floorplan-marker-status-inactive': tone === 'inactive',
		'floorplan-marker-rack': placement.rack_id !== null,
		'floorplan-marker-outlet': placement.port !== null,
		'floorplan-marker-jack': isJack(placement.port),
		// A jack only counts as cabled with all its ports cabled.
		'floorplan-marker-cabled':
			placement.port?.ports.every((port: FloorplanOutletPortJson) => port.connected) ===
				true && placement.port.ports.length > 0,
		'floorplan-marker-inactive': placement.status !== null && placement.status !== 'active',
	}
}

/** Zoom range of the stage; 1 fits the whole plan. */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 8

/** Factor of one zoom button step. */
const ZOOM_STEP = 1.5

/** Pointer travel (px) after which a press on the stage pans instead of clicking. */
const PAN_THRESHOLD = 4

/** Normalized box on the plan. */
export interface PlanBox {
	x0: number
	y0: number
	x1: number
	y1: number
}

/** Zoom and pan state of a stage, created by its owner so lists can focus objects. */
export interface StageZoom {
	scale: Accessor<number>
	/** Translation of the scaled stage in the viewport, px. */
	offset: Accessor<{ x: number; y: number }>
	/** Unscaled layout size of the stage, px. */
	size: Accessor<{ width: number; height: number }>
	/** Zooms by `factor` keeping viewport point (`px`, `py`) in place; the center without one. */
	zoomBy: (factor: number, px?: number, py?: number) => void
	panBy: (dx: number, dy: number) => void
	reset: () => void
	/** Zooms to fit `box` (at least `minScale`) and centers it. */
	focus: (box: PlanBox, minScale?: number) => void
	/** Normalized center of the visible part of the plan. */
	viewCenter: () => [number, number]
	/** Measures the stage; called by `FloorplanStage`. */
	setSize: (width: number, height: number) => void
}

function clampZoom(value: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function createStageZoom(): StageZoom {
	const [scale, setScale] = createSignal(1)
	const [offset, setOffset] = createSignal({ x: 0, y: 0 })
	const [size, setSizeSignal] = createSignal({ width: 0, height: 0 })

	/** Keeps the scaled stage covering the viewport. */
	function place(nextScale: number, x: number, y: number): void {
		const { width, height } = size()
		setScale(nextScale)
		setOffset({
			x: Math.min(0, Math.max(width - width * nextScale, x)),
			y: Math.min(0, Math.max(height - height * nextScale, y)),
		})
	}

	const zoom: StageZoom = {
		scale,
		offset,
		size,
		zoomBy(factor: number, px?: number, py?: number): void {
			const { width, height } = size()
			const [cx, cy] = [px ?? width / 2, py ?? height / 2]
			const next = clampZoom(scale() * factor)
			const ratio = next / scale()
			place(next, cx - (cx - offset().x) * ratio, cy - (cy - offset().y) * ratio)
		},
		panBy(dx: number, dy: number): void {
			place(scale(), offset().x + dx, offset().y + dy)
		},
		reset(): void {
			place(1, 0, 0)
		},
		focus(box: PlanBox, minScale = 1): void {
			const { width, height } = size()
			const fit = Math.min(
				0.6 / Math.max(box.x1 - box.x0, 1e-3),
				0.6 / Math.max(box.y1 - box.y0, 1e-3),
			)
			const next = clampZoom(Math.max(minScale, Math.min(fit, MAX_ZOOM)))
			const cx = ((box.x0 + box.x1) / 2) * width * next
			const cy = ((box.y0 + box.y1) / 2) * height * next
			place(next, width / 2 - cx, height / 2 - cy)
		},
		viewCenter(): [number, number] {
			const { width, height } = size()
			if (width === 0 || height === 0) {
				return [0.5, 0.5]
			}
			return [
				(width / 2 - offset().x) / (width * scale()),
				(height / 2 - offset().y) / (height * scale()),
			]
		},
		setSize(width: number, height: number): void {
			// A hidden stage (its in-app tab in the background) measures 0 × 0;
			// keep the last size so zoom and pan come back unchanged.
			if (width === 0 || height === 0) {
				return
			}
			const before = size()
			setSizeSignal({ width, height })
			if (before.width > 0 && before.width !== width) {
				// Keep the same part of the plan in view when the layout resizes.
				const ratio = width / before.width
				place(scale(), offset().x * ratio, offset().y * ratio)
			}
		},
	}
	return zoom
}

/** Bounding box of an area. */
export function areaBox(area: Pick<FloorplanAreaJson, 'points'>): PlanBox {
	const xs = area.points.map((point) => point[0])
	const ys = area.points.map((point) => point[1])
	return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** Markers closer than this on screen (px) are combined, or spread at full zoom. */
const CLUSTER_PX = 26

/** A marker as drawn: shifted by `dx` / `dy` (px) when spread out of a crowd. */
export interface ShownMarker {
	placement: FloorplanPlacementJson
	x: number
	y: number
	dx: number
	dy: number
}

/** Markers too close to tell apart below full zoom, drawn as one count bubble. */
export interface MarkerCluster {
	key: string
	x: number
	y: number
	members: FloorplanPlacementJson[]
}

/**
 * Splits markers into single ones and clusters by their distance on screen.
 * At full zoom a crowd is spread on a ring around its center instead;
 * `pinned` (the selected marker) is never clustered.
 */
export function declutter(
	placements: FloorplanPlacementJson[],
	zoom: StageZoom,
	pinned: number | null,
): { markers: ShownMarker[]; clusters: MarkerCluster[] } {
	const { width, height } = zoom.size()
	const scale = zoom.scale()
	const single = (placement: FloorplanPlacementJson): ShownMarker => ({
		placement,
		x: placement.x,
		y: placement.y,
		dx: 0,
		dy: 0,
	})
	if (width === 0 || height === 0) {
		return { markers: placements.map(single), clusters: [] }
	}
	const groups: { x: number; y: number; members: FloorplanPlacementJson[] }[] = []
	const markers: ShownMarker[] = []
	for (const placement of placements) {
		if (placement.id === pinned) {
			markers.push(single(placement))
			continue
		}
		const px = placement.x * width * scale
		const py = placement.y * height * scale
		const near = groups.find((group) => Math.hypot(group.x - px, group.y - py) < CLUSTER_PX)
		if (near) {
			near.members.push(placement)
		} else {
			groups.push({ x: px, y: py, members: [placement] })
		}
	}
	const clusters: MarkerCluster[] = []
	for (const group of groups) {
		if (group.members.length === 1) {
			markers.push(single(group.members[0]))
			continue
		}
		const x = group.members.reduce((sum, p) => sum + p.x, 0) / group.members.length
		const y = group.members.reduce((sum, p) => sum + p.y, 0) / group.members.length
		if (scale < MAX_ZOOM) {
			clusters.push({
				key: group.members.map((p) => p.id).join(','),
				x,
				y,
				members: group.members,
			})
			continue
		}
		const radius = Math.max(CLUSTER_PX, (group.members.length * 32) / (2 * Math.PI))
		group.members.forEach((placement, index) => {
			const angle = (index / group.members.length) * 2 * Math.PI - Math.PI / 2
			markers.push({
				placement,
				x,
				y,
				dx: Math.cos(angle) * radius,
				dy: Math.sin(angle) * radius,
			})
		})
	}
	return { markers, clusters }
}

/** Scale and origin of a plan, as the stage draws them. */
export interface PlanCalibration {
	scale: FloorplanScale | null
	origin: [number, number] | null
}

type ImageSize = Pick<AttachmentJson, 'width_px' | 'height_px'>

/** Distance between two normalized points in image pixels. */
export function pixelDistance(image: ImageSize, a: [number, number], b: [number, number]): number {
	return Math.hypot((b[0] - a[0]) * image.width_px, (b[1] - a[1]) * image.height_px)
}

/** Meters per image pixel of a scale. */
export function metersPerPixel(image: ImageSize, scale: FloorplanScale): number {
	return scale.centimeters / 100 / pixelDistance(image, scale.a, scale.b)
}

/** Position of a normalized point in meters from the origin (top left without one), y up. */
export function planMeters(
	image: ImageSize,
	calibration: PlanCalibration & { scale: FloorplanScale },
	point: [number, number],
): [number, number] {
	const mpp = metersPerPixel(image, calibration.scale)
	const [ox, oy] = calibration.origin ?? [0, 0]
	return [(point[0] - ox) * image.width_px * mpp, (oy - point[1]) * image.height_px * mpp]
}

/** A length in meters for display, with up to two decimals. */
export function formatMeters(value: number): string {
	return t('floorplan.meters', {
		value: new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value),
	})
}

/** A recorded distance in centimeters for display. */
export function formatCentimeters(value: number): string {
	return t('floorplan.centimeters', { value: new Intl.NumberFormat(locale()).format(value) })
}

/** Most grid lines per axis, a guard against degenerate scales. */
const GRID_MAX_LINES = 500

/** Normalized positions of lines `step` apart through `origin`, within 0..1, with their index. */
function gridLines(origin: number, step: number): { at: number; index: number }[] {
	if (!(step > 0) || 1 / step > GRID_MAX_LINES) {
		return []
	}
	const lines: { at: number; index: number }[] = []
	for (let index = Math.ceil(-origin / step); origin + index * step <= 1; index++) {
		lines.push({ at: origin + index * step, index })
	}
	return lines
}

/**
 * Metric grid through the origin, the chosen grid size apart; the axes
 * through a set origin are drawn stronger, with a crosshair at the origin.
 */
function GridLayer(props: {
	attachment: AttachmentJson
	calibration: PlanCalibration & { scale: FloorplanScale }
}): JSX.Element {
	const metersWide = (): number =>
		props.attachment.width_px * metersPerPixel(props.attachment, props.calibration.scale)
	const metersHigh = (): number =>
		props.attachment.height_px * metersPerPixel(props.attachment, props.calibration.scale)
	const origin = (): [number, number] => props.calibration.origin ?? [0, 0]
	const columns = (): { at: number; index: number }[] =>
		gridLines(origin()[0], gridSize() / metersWide())
	const rows = (): { at: number; index: number }[] =>
		gridLines(origin()[1], gridSize() / metersHigh())
	const axis = (index: number): boolean => index === 0 && props.calibration.origin !== null
	return (
		<svg
			class="floorplan-overlay floorplan-grid"
			viewBox="0 0 1 1"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<For each={columns()}>
				{(line: { at: number; index: number }) => (
					<line
						classList={{ 'floorplan-grid-axis': axis(line.index) }}
						x1={line.at}
						x2={line.at}
						y1={0}
						y2={1}
					/>
				)}
			</For>
			<For each={rows()}>
				{(line: { at: number; index: number }) => (
					<line
						classList={{ 'floorplan-grid-axis': axis(line.index) }}
						x1={0}
						x2={1}
						y1={line.at}
						y2={line.at}
					/>
				)}
			</For>
		</svg>
	)
}

/** Grid size choice below the stage. */
function GridSizeSelect(): JSX.Element {
	return (
		<label class="floorplan-grid-size">
			<span>{t('floorplan.gridSize')}</span>
			<select
				value={String(gridSize())}
				onChange={(e: Event & { currentTarget: HTMLSelectElement }) => {
					const value = Number(e.currentTarget.value)
					setGridSize(GRID_SIZES.find((size) => size === value) ?? DEFAULT_GRID_SIZE)
				}}
			>
				<For each={GRID_SIZES}>
					{(size: GridSize) => <option value={String(size)}>{formatMeters(size)}</option>}
				</For>
			</select>
		</label>
	)
}

/** Pointer position over the plan in meters; empty while the pointer is off the plan. */
function PointerReadout(props: { pointer: [number, number] | null }): JSX.Element {
	return (
		<span class="floorplan-readout" aria-live="off">
			{props.pointer
				? t('floorplan.pointerPosition', {
						x: formatMeters(props.pointer[0]),
						y: formatMeters(props.pointer[1]),
					})
				: ''}
		</span>
	)
}

/** Zoom in / out / fit buttons below the stage. */
function ZoomControls(props: { zoom: StageZoom }): JSX.Element {
	return (
		<div class="floorplan-zoom-controls" title={t('floorplan.zoomHint')}>
			<button
				type="button"
				class="floorplan-zoom-button"
				aria-label={t('floorplan.zoomIn')}
				title={t('floorplan.zoomIn')}
				disabled={props.zoom.scale() >= MAX_ZOOM}
				onClick={() => props.zoom.zoomBy(ZOOM_STEP)}
			>
				<IconZoomIn size={16} />
			</button>
			<button
				type="button"
				class="floorplan-zoom-button"
				aria-label={t('floorplan.zoomOut')}
				title={t('floorplan.zoomOut')}
				disabled={props.zoom.scale() <= MIN_ZOOM}
				onClick={() => props.zoom.zoomBy(1 / ZOOM_STEP)}
			>
				<IconZoomOut size={16} />
			</button>
			<button
				type="button"
				class="floorplan-zoom-button"
				aria-label={t('floorplan.zoomReset')}
				title={t('floorplan.zoomReset')}
				disabled={props.zoom.scale() <= MIN_ZOOM}
				onClick={() => props.zoom.reset()}
			>
				<IconZoomReset size={16} />
			</button>
		</div>
	)
}

/**
 * The image capped at 60vh high with the overlay layers (`children`) on
 * top, in a viewport that zooms (buttons, Ctrl + wheel, pinch) and pans (drag
 * on the plan while zoomed in; the middle button on markers and labels
 * too).
 */
export function FloorplanStage(props: {
	attachment: AttachmentJson
	zoom: StageZoom
	children: JSX.Element
	/** Stage element, to map pointer positions to plan coordinates. */
	ref?: (el: HTMLDivElement) => void
	/** Extra handlers of the stage (the edit mode's drop target and deselect). */
	handlers?: JSX.HTMLAttributes<HTMLDivElement>
	/** Scale and origin; with a scale the stage draws the grid and measures the pointer. */
	calibration?: PlanCalibration
}): JSX.Element {
	let viewport!: HTMLDivElement
	let stage!: HTMLDivElement
	/** Active pointers on the viewport, for pan and pinch. */
	const pointers = new Map<number, { x: number; y: number }>()
	let travelled = 0
	/** Pointer position over the plan in meters, while there is a scale. */
	const [pointer, setPointer] = createSignal<[number, number] | null>(null)
	/** A middle-button pan is in progress. */
	const [forcedPan, setForcedPan] = createSignal(false)
	const zoomed = (): boolean => props.zoom.scale() > MIN_ZOOM
	const scaled = (): (PlanCalibration & { scale: FloorplanScale }) | undefined => {
		const calibration = props.calibration
		return calibration?.scale ? { ...calibration, scale: calibration.scale } : undefined
	}

	const trackPointer = (e: PointerEvent): void => {
		const calibration = scaled()
		const box = stage.getBoundingClientRect()
		if (!calibration || box.width === 0 || box.height === 0) {
			setPointer(null)
			return
		}
		const x = (e.clientX - box.left) / box.width
		const y = (e.clientY - box.top) / box.height
		setPointer(
			x < 0 || x > 1 || y < 0 || y > 1
				? null
				: planMeters(props.attachment, calibration, [x, y]),
		)
	}

	const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
		const box = viewport.getBoundingClientRect()
		return { x: e.clientX - box.left, y: e.clientY - box.top }
	}

	const onWheel = (e: WheelEvent): void => {
		// Plain wheel scrolls the page; Ctrl + wheel (and trackpad pinch) zooms.
		if (!e.ctrlKey && !e.metaKey) {
			return
		}
		e.preventDefault()
		const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
		const at = local(e)
		props.zoom.zoomBy(Math.exp(-delta * 0.002), at.x, at.y)
	}

	const onPointerDown = (e: PointerEvent): void => {
		if ((e.target as Element).closest('.floorplan-popover')) {
			return
		}
		if (e.pointerType === 'mouse' && e.button !== 0) {
			return
		}
		if (pointers.size === 0) {
			travelled = 0
		}
		pointers.set(e.pointerId, local(e))
		if (props.zoom.scale() > MIN_ZOOM || pointers.size > 1) {
			// No text selection or native link / image drag while panning.
			e.preventDefault()
		}
	}

	/**
	 * Capture phase, ahead of the editor's drag handlers: a middle-button
	 * press pans instead of reaching the marker or label below.
	 */
	const onPointerDownCapture = (e: PointerEvent): void => {
		const middle = e.pointerType === 'mouse' && e.button === 1
		if (!zoomed() || !middle) {
			return
		}
		if ((e.target as Element).closest('.floorplan-popover')) {
			return
		}
		e.preventDefault()
		e.stopPropagation()
		pointers.set(e.pointerId, local(e))
		// Pans from the first move; the click after release is swallowed.
		travelled = PAN_THRESHOLD
		setForcedPan(true)
	}

	const onPointerMove = (e: PointerEvent): void => {
		const last = pointers.get(e.pointerId)
		if (!last) {
			return
		}
		const at = local(e)
		if (pointers.size === 2) {
			const [other] = [...pointers.entries()].filter(([id]) => id !== e.pointerId)
			const before = Math.hypot(last.x - other[1].x, last.y - other[1].y)
			const after = Math.hypot(at.x - other[1].x, at.y - other[1].y)
			if (before > 0) {
				props.zoom.zoomBy(after / before, (at.x + other[1].x) / 2, (at.y + other[1].y) / 2)
			}
			travelled += PAN_THRESHOLD
		} else if (props.zoom.scale() > MIN_ZOOM) {
			travelled += Math.hypot(at.x - last.x, at.y - last.y)
			if (travelled >= PAN_THRESHOLD) {
				props.zoom.panBy(at.x - last.x, at.y - last.y)
			}
		}
		pointers.set(e.pointerId, at)
	}

	const onPointerUp = (e: PointerEvent): void => {
		pointers.delete(e.pointerId)
		if (pointers.size === 0) {
			setForcedPan(false)
		}
	}

	// A press that panned does not also click the area or marker below.
	const onClickCapture = (e: MouseEvent): void => {
		if (travelled >= PAN_THRESHOLD) {
			e.preventDefault()
			e.stopPropagation()
			travelled = 0
		}
	}

	onMount(() => {
		// Non-passive, so Ctrl + wheel does not also zoom the page.
		viewport.addEventListener('wheel', onWheel, { passive: false })
		viewport.addEventListener('click', onClickCapture, true)
		viewport.addEventListener('pointerdown', onPointerDownCapture, true)
		window.addEventListener('pointermove', onPointerMove)
		window.addEventListener('pointerup', onPointerUp)
		window.addEventListener('pointercancel', onPointerUp)
		const observer = new ResizeObserver(() =>
			props.zoom.setSize(stage.offsetWidth, stage.offsetHeight),
		)
		observer.observe(stage)
		onCleanup(() => {
			observer.disconnect()
			viewport.removeEventListener('wheel', onWheel)
			viewport.removeEventListener('click', onClickCapture, true)
			viewport.removeEventListener('pointerdown', onPointerDownCapture, true)
			window.removeEventListener('pointermove', onPointerMove)
			window.removeEventListener('pointerup', onPointerUp)
			window.removeEventListener('pointercancel', onPointerUp)
		})
	})

	return (
		<div class="floorplan-frame">
			<div
				class="floorplan-viewport"
				classList={{ zoomed: zoomed(), 'status-colors': statusColorsVisible() }}
				ref={viewport}
				onPointerDown={onPointerDown}
				onPointerMove={trackPointer}
				onPointerLeave={() => setPointer(null)}
			>
				<div
					class="floorplan-stage"
					ref={(el: HTMLDivElement) => {
						stage = el
						props.ref?.(el)
					}}
					style={{
						transform: `translate(${props.zoom.offset().x}px, ${props.zoom.offset().y}px) scale(${props.zoom.scale()})`,
						'--floorplan-inv-zoom': String(1 / props.zoom.scale()),
					}}
					{...props.handlers}
				>
					<img
						src={attachment_file_url(props.attachment)}
						alt={t('floorplan.image', {
							name: props.attachment.description || props.attachment.filename,
						})}
						width={props.attachment.width_px}
						height={props.attachment.height_px}
						draggable={false}
					/>
					<Show when={gridVisible() && scaled()}>
						{(calibration: Accessor<PlanCalibration & { scale: FloorplanScale }>) => (
							<GridLayer attachment={props.attachment} calibration={calibration()} />
						)}
					</Show>
					<Show when={props.calibration?.origin}>
						{(origin: Accessor<[number, number]>) => (
							<span
								class="floorplan-origin"
								style={{ left: percent(origin()[0]), top: percent(origin()[1]) }}
								title={t('floorplan.origin')}
							/>
						)}
					</Show>
					{props.children}
				</div>
				<Show when={forcedPan()}>
					<div class="floorplan-pan-cover" />
				</Show>
			</div>
			<div class="floorplan-stage-bar">
				<ZoomControls zoom={props.zoom} />
				<Show when={scaled()}>
					<Show when={gridVisible()}>
						<GridSizeSelect />
					</Show>
					<PointerReadout pointer={pointer()} />
				</Show>
			</div>
		</div>
	)
}
