/**
 * Stage of a drawn floor plan, shared by the view and the editor: the sheet
 * in a `ZoomViewport` (design decision 0003) with the reference image,
 * another floor of the building faded beneath (the underlay), the grid,
 * the rooms, stairs, desks, desk groups, cable trays and room dividers, the
 * walls with their doors and windows, the pillars, and the owner's overlay pieces (`children`) on
 * top.
 *
 * The SVG's user units are the sheet's centimeters (`viewBox` = sheet), so
 * walls are drawn at their real size. HTML overlay pieces (markers, labels,
 * handles) are positioned in percent of the sheet like on image plans and
 * keep their screen size through `--inv-zoom`.
 */
import type {
	FloorplanDesk,
	FloorplanDeskGroup,
	FloorplanOpening,
	FloorplanPartition,
	FloorplanPillar,
	FloorplanReference,
	FloorplanRoom,
	FloorplanStair,
	FloorplanTray,
	FloorplanWall,
} from 'shared/src/schemas'
import { createMemo, createSignal, createUniqueId, For, type JSX, Show } from 'solid-js'
import { type AttachmentJson, attachment_file_url } from '../api/attachments'
import type { FloorplanDrawingJson } from '../api/floorplan_drawings'
import { locale, t } from '../i18n'
import { readStored, writeStored } from '../lib/storage'
import {
	DESK_GROUP_DESKS,
	deskGroupArms,
	deskGroupDesk,
	deskOutline,
	type OpeningShape,
	openingShape,
	type Point,
	partitionOutline,
	pillarOutline,
	polygonCenter,
	type StairShape,
	stairShape,
	wallPieces,
} from './drawn_plan_geometry'
import { type StageZoom, ZoomViewport } from './zoom_viewport'

/**
 * Natural size of the stage per sheet centimeter: large enough that the
 * fitted stage is never capped by it (the fill layout never upscales).
 */
const STAGE_PX_PER_CM = 10

/** Grid lines closer than this on screen (px) are not drawn. */
const MIN_GRID_PX = 6

/** Most grid lines per axis. */
const MAX_GRID_LINES = 1000

const OPACITY_STORAGE_KEY = 'conex:drawn-plan-reference-opacity'
const REFERENCE_STORAGE_KEY = 'conex:drawn-plan-reference'

function loadOpacity(): number {
	const stored = Number(readStored(OPACITY_STORAGE_KEY))
	return Number.isFinite(stored) && stored >= 0.1 && stored <= 1 ? stored : 0.5
}

const [opacity, setOpacity] = createSignal(loadOpacity())
const [referenceShown, setReferenceShown] = createSignal(
	readStored(REFERENCE_STORAGE_KEY) !== 'false',
)

/** Opacity of reference images under drawn plans (kept per browser). */
export function referenceOpacity(): number {
	return opacity()
}

export function setReferenceOpacity(value: number): void {
	setOpacity(value)
	writeStored(OPACITY_STORAGE_KEY, String(value))
}

/** Whether the view shows the reference image under the drawing (on by default). */
export function referenceVisible(): boolean {
	return referenceShown()
}

export function toggleReferenceVisible(): void {
	const next = !referenceShown()
	setReferenceShown(next)
	writeStored(REFERENCE_STORAGE_KEY, String(next))
}

/** Sheet size in cm. */
export interface Sheet {
	width: number
	height: number
}

/** A reference image as the stage draws it. */
export type StageReference = FloorplanReference & { attachment: AttachmentJson }

/** A wall with its openings, as the stage draws it. */
export interface StageWall {
	key: string
	wall: FloorplanWall
	openings: { key: string; opening: FloorplanOpening }[]
}

export function percentOf(value: number, total: number): string {
	return `${(value / total) * 100}%`
}

/** A length in cm for display: meters from 1 m on, with up to two decimals. */
export function formatLength(centimeters: number): string {
	const format = (value: number, digits: number): string =>
		new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value)
	return Math.abs(centimeters) >= 100
		? t('floorplan.meters', { value: format(centimeters / 100, 2) })
		: t('floorplan.centimeters', { value: format(centimeters, 1) })
}

export function svgPoints(points: Point[]): string {
	return points.map((point: Point) => point.join(',')).join(' ')
}

/** Screen px per sheet centimeter at the current zoom. */
export function pxPerCm(zoom: StageZoom, sheet: Sheet): number {
	const width = zoom.size().width
	return width > 0 ? (width * zoom.scale()) / sheet.width : 0
}

/** Grid lines `step` cm apart, and stronger ones every meter, while far enough apart on screen. */
function GridLines(props: { sheet: Sheet; step: number; zoom: StageZoom }): JSX.Element {
	const lines = (step: number): { x: number[]; y: number[] } => {
		const px = pxPerCm(props.zoom, props.sheet)
		if (
			step * px < MIN_GRID_PX ||
			Math.max(props.sheet.width, props.sheet.height) / step > MAX_GRID_LINES
		) {
			return { x: [], y: [] }
		}
		const axis = (extent: number): number[] =>
			Array.from({ length: Math.floor(extent / step) + 1 }, (_, i) => i * step)
		return { x: axis(props.sheet.width), y: axis(props.sheet.height) }
	}
	// Stronger lines every meter below a 1 m grid, every 5 m on a 1 m grid;
	// the 5 m and 10 m grids are coarse enough on their own.
	const majorStep = (): number | null =>
		props.step < 100 ? 100 : props.step === 100 ? 500 : null
	const minor = createMemo(() => lines(props.step))
	const major = createMemo(() => {
		const step = majorStep()
		return step === null ? { x: [], y: [] } : lines(step)
	})
	const Lines = (p: { set: { x: number[]; y: number[] }; class: string }): JSX.Element => (
		<g class={p.class}>
			<For each={p.set.x}>
				{(x: number): JSX.Element => <line x1={x} x2={x} y1={0} y2={props.sheet.height} />}
			</For>
			<For each={p.set.y}>
				{(y: number): JSX.Element => <line x1={0} x2={props.sheet.width} y1={y} y2={y} />}
			</For>
		</g>
	)
	return (
		<>
			<Lines set={minor()} class="drawn-plan-grid" />
			<Lines set={major()} class="drawn-plan-grid drawn-plan-grid-major" />
		</>
	)
}

/** One door or window: its gap, then the leaf and swing, the sliding panel or the glass. */
export function OpeningGlyph(props: { shape: OpeningShape }): JSX.Element {
	return (
		<>
			<polygon class="drawn-plan-opening-gap" points={svgPoints(props.shape.gap)} />
			<Show when={props.shape.glass}>
				{(glass: () => [Point, Point]) => (
					<line
						class="drawn-plan-window"
						x1={glass()[0][0]}
						y1={glass()[0][1]}
						x2={glass()[1][0]}
						y2={glass()[1][1]}
					/>
				)}
			</Show>
			<Show when={props.shape.leaf}>
				{(leaf: () => [Point, Point]) => (
					<line
						class="drawn-plan-door-leaf"
						x1={leaf()[0][0]}
						y1={leaf()[0][1]}
						x2={leaf()[1][0]}
						y2={leaf()[1][1]}
					/>
				)}
			</Show>
			<Show when={props.shape.arc}>
				{(arc: () => string) => <path class="drawn-plan-door-swing" d={arc()} />}
			</Show>
			<Show when={props.shape.panel}>
				{(panel: () => Point[]) => (
					<polygon class="drawn-plan-door-panel" points={svgPoints(panel())} />
				)}
			</Show>
			<Show when={props.shape.slide}>
				{(slide: () => string) => <path class="drawn-plan-door-slide" d={slide()} />}
			</Show>
		</>
	)
}

/** One flight of stairs: outline, treads and the arrow up. */
export function StairGlyph(props: { shape: StairShape }): JSX.Element {
	return (
		<>
			<polygon class="drawn-plan-stair" points={svgPoints(props.shape.outline)} />
			<For each={props.shape.treads}>
				{(tread: [Point, Point]) => (
					<line
						class="drawn-plan-stair-tread"
						x1={tread[0][0]}
						y1={tread[0][1]}
						x2={tread[1][0]}
						y2={tread[1][1]}
					/>
				)}
			</For>
			<path class="drawn-plan-stair-arrow" d={props.shape.arrow} />
		</>
	)
}

/** Stairs as the stage draws them. */
export interface StageStair {
	key: string
	stair: FloorplanStair
}

/** Stairs, under the walls. The editor passes a press handler and the selection. */
export function StairLayer(props: {
	stairs: StageStair[]
	selected?: string | null
	on_press?: (e: PointerEvent, key: string) => void
}): JSX.Element {
	return (
		<For each={props.stairs}>
			{(item: StageStair) => (
				<g
					class="drawn-plan-stairs"
					classList={{
						selected: props.selected === item.key,
						editable: props.on_press !== undefined,
					}}
					onPointerDown={(e: PointerEvent) => props.on_press?.(e, item.key)}
				>
					<StairGlyph shape={stairShape(item.stair)} />
				</g>
			)}
		</For>
	)
}

/** Names of `locations` by id. */
export function locationNames(locations: { id: number; name: string }[]): Map<number, string> {
	return new Map(locations.map((location) => [location.id, location.name]))
}

/** A drawn element as the stage draws it, keyed for selection. */
export interface StageItem<T> {
	key: string
	item: T
}

/** One desk, alone or of a desk group: where its label goes and the location it links to. */
export interface DeskSeat {
	key: string
	at: Point
	/** Height of the desk top above the floor, cm. */
	height: number
	location_id: number | undefined
}

/** Every desk of `desks` and `groups`; a group's desks are keyed `<group key>:<index>`. */
export function deskSeats(
	desks: StageItem<FloorplanDesk>[],
	groups: StageItem<FloorplanDeskGroup>[],
): DeskSeat[] {
	return [
		...desks.map((entry: StageItem<FloorplanDesk>) => ({
			key: entry.key,
			at: polygonCenter(deskOutline(entry.item)),
			height: entry.item.height,
			location_id: entry.item.location_id,
		})),
		...groups.flatMap((entry: StageItem<FloorplanDeskGroup>) =>
			DESK_GROUP_DESKS.map((index: number) => ({
				key: `${entry.key}:${index}`,
				at: polygonCenter(deskGroupDesk(entry.item, index)),
				height: entry.item.height,
				location_id: entry.item.location_ids[index] ?? undefined,
			})),
		),
	]
}

/** Press handler and selection the editor passes to a layer; the view passes neither. */
interface LayerEditing {
	selected?: string | null
	on_press?: (e: PointerEvent, key: string) => void
}

/**
 * Rooms, under everything else. Only their outline takes presses (the
 * editor also selects a room by its label), so clicks inside reach the
 * floor below.
 */
export function RoomLayer(
	props: { rooms: StageItem<FloorplanRoom>[] } & LayerEditing,
): JSX.Element {
	return (
		<For each={props.rooms}>
			{(entry: StageItem<FloorplanRoom>) => (
				<g
					class="drawn-plan-room"
					classList={{
						selected: props.selected === entry.key,
						editable: props.on_press !== undefined,
						linked: entry.item.location_id !== undefined,
					}}
				>
					<polygon class="drawn-plan-room-area" points={svgPoints(entry.item.points)} />
					<polygon
						class="drawn-plan-room-edge"
						points={svgPoints(entry.item.points)}
						onPointerDown={(e: PointerEvent) => props.on_press?.(e, entry.key)}
					/>
				</g>
			)}
		</For>
	)
}

/** Desks, over rooms and stairs. */
export function DeskLayer(
	props: { desks: StageItem<FloorplanDesk>[] } & LayerEditing,
): JSX.Element {
	return (
		<For each={props.desks}>
			{(entry: StageItem<FloorplanDesk>) => (
				<polygon
					class="drawn-plan-desk"
					classList={{
						selected: props.selected === entry.key,
						editable: props.on_press !== undefined,
						linked: entry.item.location_id !== undefined,
					}}
					points={svgPoints(deskOutline(entry.item))}
					onPointerDown={(e: PointerEvent) => props.on_press?.(e, entry.key)}
				/>
			)}
		</For>
	)
}

/**
 * Desk groups, beside the desks: three desks each, a tint on those linked
 * to a location, and the dividers between them.
 */
export function DeskGroupLayer(
	props: { groups: StageItem<FloorplanDeskGroup>[] } & LayerEditing,
): JSX.Element {
	return (
		<For each={props.groups}>
			{(entry: StageItem<FloorplanDeskGroup>) => (
				<g
					class="drawn-plan-desk-group"
					onPointerDown={(e: PointerEvent) => props.on_press?.(e, entry.key)}
				>
					<For each={DESK_GROUP_DESKS}>
						{(index: number) => (
							<polygon
								class="drawn-plan-desk"
								classList={{
									selected: props.selected === entry.key,
									editable: props.on_press !== undefined,
									linked: entry.item.location_ids[index] !== null,
								}}
								points={svgPoints(deskGroupDesk(entry.item, index))}
							/>
						)}
					</For>
					<For each={deskGroupArms(entry.item)}>
						{(end: Point) => (
							<line
								class="drawn-plan-desk-divider"
								x1={entry.item.center[0]}
								y1={entry.item.center[1]}
								x2={end[0]}
								y2={end[1]}
							/>
						)}
					</For>
				</g>
			)}
		</For>
	)
}

/**
 * Cable trays, over desks and under the walls. The runs share one
 * translucent group, so where they meet or cross they do not darken.
 */
export function TrayLayer(
	props: { trays: StageItem<FloorplanTray>[] } & LayerEditing,
): JSX.Element {
	const line = (entry: StageItem<FloorplanTray>, cls: string, width?: number): JSX.Element => (
		<line
			class={cls}
			x1={entry.item.a[0]}
			y1={entry.item.a[1]}
			x2={entry.item.b[0]}
			y2={entry.item.b[1]}
			stroke-width={width}
		/>
	)
	return (
		<>
			<g class="drawn-plan-trays">
				<For each={props.trays}>
					{(entry: StageItem<FloorplanTray>) => (
						<g
							class="drawn-plan-tray"
							classList={{
								selected: props.selected === entry.key,
								editable: props.on_press !== undefined,
							}}
							onPointerDown={(e: PointerEvent) => props.on_press?.(e, entry.key)}
						>
							{line(entry, 'drawn-plan-tray-body', entry.item.width)}
						</g>
					)}
				</For>
			</g>
			<For each={props.trays}>
				{(entry: StageItem<FloorplanTray>) => line(entry, 'drawn-plan-tray-axis')}
			</For>
		</>
	)
}

/** Room dividers, over the trays and under the walls. */
export function PartitionLayer(
	props: { partitions: StageItem<FloorplanPartition>[] } & LayerEditing,
): JSX.Element {
	return (
		<For each={props.partitions}>
			{(entry: StageItem<FloorplanPartition>) => (
				<polygon
					class="drawn-plan-partition"
					classList={{
						selected: props.selected === entry.key,
						editable: props.on_press !== undefined,
					}}
					points={svgPoints(partitionOutline(entry.item))}
					onPointerDown={(e: PointerEvent) => props.on_press?.(e, entry.key)}
				/>
			)}
		</For>
	)
}

/** Pillars, over the walls they may stand in. */
export function PillarLayer(
	props: { pillars: StageItem<FloorplanPillar>[] } & LayerEditing,
): JSX.Element {
	return (
		<For each={props.pillars}>
			{(entry: StageItem<FloorplanPillar>) => (
				<polygon
					class="drawn-plan-pillar"
					classList={{
						selected: props.selected === entry.key,
						editable: props.on_press !== undefined,
					}}
					points={svgPoints(pillarOutline(entry.item))}
					onPointerDown={(e: PointerEvent) => props.on_press?.(e, entry.key)}
				/>
			)}
		</For>
	)
}

/**
 * Walls with their openings. The editor passes press handlers and the
 * selection; the view draws them inert.
 */
export function WallLayer(props: {
	walls: StageWall[]
	selected?: string | null
	on_wall_press?: (e: PointerEvent, key: string) => void
	on_opening_press?: (e: PointerEvent, key: string) => void
}): JSX.Element {
	return (
		<For each={props.walls}>
			{(item: StageWall) => (
				<g class="drawn-plan-wall-group">
					<For
						each={wallPieces(
							item.wall,
							item.openings.map((entry) => entry.opening),
						)}
					>
						{(piece: Point[]) => (
							<polygon
								class="drawn-plan-wall"
								classList={{
									selected: props.selected === item.key,
									editable: props.on_wall_press !== undefined,
								}}
								points={svgPoints(piece)}
								onPointerDown={(e: PointerEvent) =>
									props.on_wall_press?.(e, item.key)
								}
							/>
						)}
					</For>
					<For each={item.openings}>
						{(entry: { key: string; opening: FloorplanOpening }) => (
							<g
								class="drawn-plan-opening"
								classList={{
									selected: props.selected === entry.key,
									editable: props.on_opening_press !== undefined,
								}}
								onPointerDown={(e: PointerEvent) =>
									props.on_opening_press?.(e, entry.key)
								}
							>
								<OpeningGlyph shape={openingShape(item.wall, entry.opening)} />
							</g>
						)}
					</For>
				</g>
			)}
		</For>
	)
}

/** The plan's walls with their openings, keyed by index. */
export function drawingWalls(drawing: FloorplanDrawingJson): StageWall[] {
	return drawing.walls.map((wall, index: number) => ({
		key: `wall:${index}`,
		wall,
		openings: drawing.openings.flatMap((opening, i: number) =>
			opening.wall === index ? [{ key: `opening:${i}`, opening }] : [],
		),
	}))
}

/** The plan's elements of one kind, keyed by kind and index. */
export function stageItems<T>(kind: string, items: T[]): StageItem<T>[] {
	return items.map((item: T, i: number) => ({ key: `${kind}:${i}`, item }))
}

/** Pointer position on the sheet, for the readout below the stage. */
function PointerReadout(props: { pointer: Point | null }): JSX.Element {
	return (
		<span class="floorplan-readout" aria-live="off">
			{props.pointer
				? t('floorplan.pointerPosition', {
						x: formatLength(props.pointer[0]),
						y: formatLength(props.pointer[1]),
					})
				: ''}
		</span>
	)
}

/**
 * The sheet in a zoom viewport: reference image, grid, walls (`walls`) and
 * extra SVG (`svg`), then the HTML overlay pieces (`children`).
 */
export function DrawnPlanStage(props: {
	sheet: Sheet
	zoom: StageZoom
	reference: StageReference | null
	/** Opacity of the reference image, 0..1. */
	reference_opacity: number
	/** Grid step in cm; `null` hides the grid. */
	grid: number | null
	/** Another floor drawn faded under this one, clipped to the sheet. */
	underlay?: JSX.Element
	walls: JSX.Element
	svg?: JSX.Element
	children?: JSX.Element
	/** Pointer position in cm for the readout; `null` while off the sheet. */
	pointer: Point | null
	ref?: (el: HTMLDivElement) => void
	handlers?: JSX.HTMLAttributes<HTMLDivElement>
	onPointerMove?: (e: PointerEvent) => void
	onPointerLeave?: () => void
	/** Items of the bar below, after the zoom buttons and before the readout. */
	bar?: JSX.Element
}): JSX.Element {
	const clipId = `drawn-plan-sheet-${createUniqueId()}`
	const referenceHeight = (reference: StageReference): number =>
		(reference.width * reference.attachment.height_px) / reference.attachment.width_px
	return (
		<ZoomViewport
			class="drawn-plan-frame"
			zoom={props.zoom}
			keyPan
			fill={{
				width: props.sheet.width * STAGE_PX_PER_CM,
				height: props.sheet.height * STAGE_PX_PER_CM,
			}}
			ref={props.ref}
			handlers={props.handlers}
			onPointerMove={props.onPointerMove}
			onPointerLeave={props.onPointerLeave}
			bar={
				<>
					{props.bar}
					<PointerReadout pointer={props.pointer} />
				</>
			}
		>
			<svg
				class="drawn-plan-svg"
				viewBox={`0 0 ${props.sheet.width} ${props.sheet.height}`}
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<rect
					class="drawn-plan-sheet"
					width={props.sheet.width}
					height={props.sheet.height}
				/>
				<clipPath id={clipId}>
					<rect width={props.sheet.width} height={props.sheet.height} />
				</clipPath>
				<Show when={props.reference}>
					{(reference: () => StageReference) => (
						// Clipped to the sheet: a moved or scaled image may stick out of it.
						<image
							clip-path={`url(#${clipId})`}
							href={attachment_file_url(reference().attachment)}
							x={reference().x}
							y={reference().y}
							width={reference().width}
							height={referenceHeight(reference())}
							preserveAspectRatio="none"
							opacity={props.reference_opacity}
						/>
					)}
				</Show>
				<Show when={props.underlay}>
					<g clip-path={`url(#${clipId})`}>{props.underlay}</g>
				</Show>
				<Show when={props.grid}>
					{(step: () => number) => (
						<GridLines sheet={props.sheet} step={step()} zoom={props.zoom} />
					)}
				</Show>
				{props.walls}
				{props.svg}
			</svg>
			{props.children}
		</ZoomViewport>
	)
}
