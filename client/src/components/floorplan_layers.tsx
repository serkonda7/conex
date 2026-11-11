/**
 * Layers of a floor plan: areas by their target's kind (site or location
 * type) and markers by what they place (rack, device, outlet). The toggle bar
 * doubles as the legend; hidden layers are kept per browser in
 * `localStorage` and shared by the view and the editor. The last toggles show
 * the names of the markers on the plan, the status colours of device and
 * outlet markers (with their legend) and, on a plan with a scale, the metric
 * grid, kept the same way, as is the grid size chosen below the stage.
 */

import {
	IconBox,
	IconGrid4x4,
	IconOutlet,
	IconPalette,
	IconServer,
	IconTag,
} from '@tabler/icons-solidjs'
import { LOCATION_TYPES, type LocationType } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { FloorplanAreaJson, FloorplanPlacementJson } from '../api/attachments'
import { type MessageKey, t, tp } from '../i18n'
import type { IconComponent } from '../lib/icons'

export type AreaLayer = 'site' | LocationType
export type MarkerLayer = 'rack' | 'device' | 'outlet'
export type Layer = `area-${AreaLayer}` | `marker-${MarkerLayer}`

export const AREA_LAYERS: readonly AreaLayer[] = ['site', ...LOCATION_TYPES]
export const MARKER_LAYERS: readonly MarkerLayer[] = ['rack', 'device', 'outlet']

const MARKER_ICONS: Record<MarkerLayer, IconComponent> = {
	rack: IconBox,
	device: IconServer,
	outlet: IconOutlet,
}

export function areaLayer(area: Pick<FloorplanAreaJson, 'site_id' | 'target_type'>): Layer {
	return `area-${area.site_id !== null ? 'site' : (area.target_type ?? 'other')}`
}

export function markerLayer(placement: Pick<FloorplanPlacementJson, 'rack_id' | 'port'>): Layer {
	if (placement.rack_id !== null) {
		return 'marker-rack'
	}
	return placement.port !== null ? 'marker-outlet' : 'marker-device'
}

/** Name of a layer, plural ("Rooms"). */
export function layerLabel(layer: Layer): string {
	return t(`floorplan.layer.${layer.replace(/^(area|marker)-/, '')}` as MessageKey)
}

const STORAGE_KEY = 'conex:floorplan-hidden-layers'

function loadHidden(): Set<Layer> {
	try {
		const raw: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
		return new Set(
			Array.isArray(raw) ? (raw.filter((v) => typeof v === 'string') as Layer[]) : [],
		)
	} catch {
		return new Set()
	}
}

// One state for every plan, so a choice carries over to the next plan.
const [hidden, setHidden] = createSignal<Set<Layer>>(loadHidden())

function saveHidden(next: Set<Layer>): void {
	setHidden(next)
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
	} catch {
		// Storage unavailable: the choice applies until reload.
	}
}

export function layerVisible(layer: Layer): boolean {
	return !hidden().has(layer)
}

export function toggleLayer(layer: Layer): void {
	const next = new Set(hidden())
	if (!next.delete(layer)) {
		next.add(layer)
	}
	saveHidden(next)
}

/** Makes `layer` visible, e.g. when an object of it is selected or placed. */
export function showLayer(layer: Layer): void {
	if (hidden().has(layer)) {
		toggleLayer(layer)
	}
}

/** Shows every layer in `layers`. */
export function showLayers(layers: readonly Layer[]): void {
	const next = new Set(hidden())
	for (const layer of layers) {
		next.delete(layer)
	}
	saveHidden(next)
}

const NAMES_STORAGE_KEY = 'conex:floorplan-marker-names'

function loadMarkerNames(): boolean {
	try {
		return window.localStorage.getItem(NAMES_STORAGE_KEY) === 'true'
	} catch {
		return false
	}
}

const [markerNames, setMarkerNames] = createSignal(loadMarkerNames())

/** Whether markers show their rack, device or outlet name beside them. */
export function markerNamesVisible(): boolean {
	return markerNames()
}

export function toggleMarkerNames(): void {
	const next = !markerNames()
	setMarkerNames(next)
	try {
		window.localStorage.setItem(NAMES_STORAGE_KEY, String(next))
	} catch {
		// Storage unavailable: the choice applies until reload.
	}
}

const STATUS_STORAGE_KEY = 'conex:floorplan-status-colors'

function loadStatusColors(): boolean {
	try {
		return window.localStorage.getItem(STATUS_STORAGE_KEY) !== 'false'
	} catch {
		return true
	}
}

const [statusColors, setStatusColors] = createSignal(loadStatusColors())

/**
 * Whether device markers are coloured by their status and outlets by their
 * cabling (on by default).
 */
export function statusColorsVisible(): boolean {
	return statusColors()
}

export function toggleStatusColors(): void {
	const next = !statusColors()
	setStatusColors(next)
	try {
		window.localStorage.setItem(STATUS_STORAGE_KEY, String(next))
	} catch {
		// Storage unavailable: the choice applies until reload.
	}
}

/** Colour classes of the status legend, with their label keys. */
const DEVICE_STATUS_LEGEND: readonly { tone: string; key: MessageKey }[] = [
	{ tone: 'active', key: 'floorplan.statusActive' },
	{ tone: 'planned', key: 'floorplan.statusPlanned' },
	{ tone: 'inactive', key: 'floorplan.statusInactive' },
]

const OUTLET_LEGEND: readonly { tone: string; key: MessageKey }[] = [
	{ tone: 'cabled', key: 'floorplan.legendCabled' },
	{ tone: 'free', key: 'floorplan.legendFree' },
]

/** Legend of the status colours of the marker kinds on the plan. */
function StatusLegend(props: { devices: boolean; outlets: boolean }): JSX.Element {
	const item = (entry: { tone: string; key: MessageKey }): JSX.Element => (
		<li>
			<span
				class={`floorplan-status-dot floorplan-status-${entry.tone}`}
				aria-hidden="true"
			/>
			{t(entry.key)}
		</li>
	)
	return (
		<div class="floorplan-status-legend">
			<Show when={props.devices}>
				<span class="floorplan-status-legend-group">{tp('entity.device', 2)}:</span>
				<ul>
					<For each={DEVICE_STATUS_LEGEND}>{item}</For>
				</ul>
			</Show>
			<Show when={props.outlets}>
				<span class="floorplan-status-legend-group">{tp('entity.outlet', 2)}:</span>
				<ul>
					<For each={OUTLET_LEGEND}>{item}</For>
				</ul>
			</Show>
		</div>
	)
}

const GRID_STORAGE_KEY = 'conex:floorplan-grid'

function loadGrid(): boolean {
	try {
		return window.localStorage.getItem(GRID_STORAGE_KEY) !== 'false'
	} catch {
		return true
	}
}

const [grid, setGrid] = createSignal(loadGrid())

/** Whether a plan with a scale shows its metric grid (on by default). */
export function gridVisible(): boolean {
	return grid()
}

export function toggleGrid(): void {
	const next = !grid()
	setGrid(next)
	try {
		window.localStorage.setItem(GRID_STORAGE_KEY, String(next))
	} catch {
		// Storage unavailable: the choice applies until reload.
	}
}

/** Grid sizes to choose from, in meters. */
export const GRID_SIZES = [0.5, 1, 5] as const
export type GridSize = (typeof GRID_SIZES)[number]
export const DEFAULT_GRID_SIZE: GridSize = 1

const GRID_SIZE_STORAGE_KEY = 'conex:floorplan-grid-size'

function loadGridSize(): GridSize {
	try {
		const raw = Number(window.localStorage.getItem(GRID_SIZE_STORAGE_KEY))
		return GRID_SIZES.find((size) => size === raw) ?? DEFAULT_GRID_SIZE
	} catch {
		return DEFAULT_GRID_SIZE
	}
}

const [gridSizeSignal, setGridSizeSignal] = createSignal<GridSize>(loadGridSize())

/** Chosen grid size, the same for every plan. */
export function gridSize(): GridSize {
	return gridSizeSignal()
}

export function setGridSize(size: GridSize): void {
	setGridSizeSignal(size)
	try {
		window.localStorage.setItem(GRID_SIZE_STORAGE_KEY, String(size))
	} catch {
		// Storage unavailable: the choice applies until reload.
	}
}

/** Layers with content on the plan, in display order, with their object counts. */
export function presentLayers(
	areas: FloorplanAreaJson[],
	placements: FloorplanPlacementJson[],
): { layer: Layer; count: number }[] {
	const counts = new Map<Layer, number>()
	for (const area of areas) {
		counts.set(areaLayer(area), (counts.get(areaLayer(area)) ?? 0) + 1)
	}
	for (const placement of placements) {
		counts.set(markerLayer(placement), (counts.get(markerLayer(placement)) ?? 0) + 1)
	}
	const order: Layer[] = [
		...AREA_LAYERS.map((layer): Layer => `area-${layer}`),
		...MARKER_LAYERS.map((layer): Layer => `marker-${layer}`),
	]
	return order.flatMap((layer: Layer) => {
		const count = counts.get(layer)
		return count ? [{ layer, count }] : []
	})
}

/** Swatch of a layer: the area fill or the marker glyph. */
export function LayerSwatch(props: { layer: Layer }): JSX.Element {
	const marker = (): MarkerLayer | null =>
		props.layer.startsWith('marker-')
			? (props.layer.slice('marker-'.length) as MarkerLayer)
			: null
	return (
		<Show
			when={marker()}
			fallback={
				<span
					class={`floorplan-swatch floorplan-layer-${props.layer}`}
					aria-hidden="true"
				/>
			}
		>
			{(layer: () => MarkerLayer) => (
				<span class="floorplan-swatch floorplan-swatch-marker" aria-hidden="true">
					<Dynamic component={MARKER_ICONS[layer()]} size={12} />
				</span>
			)}
		</Show>
	)
}

/**
 * Toggle bar and legend of the layers present on the plan, plus the empty
 * hint below: nothing placed yet, or everything hidden.
 */
export function LayerBar(props: {
	areas: FloorplanAreaJson[]
	placements: FloorplanPlacementJson[]
	/** Hint for a plan without areas or markers; none in the editor. */
	empty_hint?: string
	/** The plan has a scale, so it can show the grid. */
	has_scale?: boolean
}): JSX.Element {
	const present = (): { layer: Layer; count: number }[] =>
		presentLayers(props.areas, props.placements)
	const allHidden = (): boolean =>
		present().length > 0 && present().every(({ layer }) => !layerVisible(layer))
	const hasDevices = (): boolean =>
		props.placements.some((p: FloorplanPlacementJson) => markerLayer(p) === 'marker-device')
	const hasOutlets = (): boolean =>
		props.placements.some((p: FloorplanPlacementJson) => p.port !== null)
	return (
		<>
			<Show when={present().length > 0 || props.has_scale}>
				<fieldset class="floorplan-layers">
					<legend class="visually-hidden">{t('floorplan.layers')}</legend>
					<For each={present()}>
						{(entry: { layer: Layer; count: number }) => (
							<button
								type="button"
								class="floorplan-layer-toggle"
								aria-pressed={layerVisible(entry.layer)}
								title={t(
									layerVisible(entry.layer)
										? 'floorplan.hideLayer'
										: 'floorplan.showLayer',
									{ name: layerLabel(entry.layer) },
								)}
								onClick={() => toggleLayer(entry.layer)}
							>
								<LayerSwatch layer={entry.layer} />
								<span>{layerLabel(entry.layer)}</span>
								<span class="floorplan-layer-count">{entry.count}</span>
							</button>
						)}
					</For>
					<Show when={props.placements.length > 0}>
						<button
							type="button"
							class="floorplan-layer-toggle floorplan-names-toggle"
							aria-pressed={markerNamesVisible()}
							title={t(
								markerNamesVisible()
									? 'floorplan.hideMarkerNames'
									: 'floorplan.showMarkerNames',
							)}
							onClick={toggleMarkerNames}
						>
							<IconTag size={12} aria-hidden="true" />
							<span>{t('floorplan.markerNames')}</span>
						</button>
					</Show>
					<Show when={hasDevices() || hasOutlets()}>
						<button
							type="button"
							class="floorplan-layer-toggle floorplan-names-toggle"
							aria-pressed={statusColorsVisible()}
							title={t(
								statusColorsVisible()
									? 'floorplan.hideStatusColors'
									: 'floorplan.showStatusColors',
							)}
							onClick={toggleStatusColors}
						>
							<IconPalette size={12} aria-hidden="true" />
							<span>{t('floorplan.statusColors')}</span>
						</button>
					</Show>
					<Show when={props.has_scale}>
						<button
							type="button"
							class="floorplan-layer-toggle floorplan-names-toggle"
							aria-pressed={gridVisible()}
							title={t(gridVisible() ? 'floorplan.hideGrid' : 'floorplan.showGrid')}
							onClick={toggleGrid}
						>
							<IconGrid4x4 size={12} aria-hidden="true" />
							<span>{t('floorplan.grid')}</span>
						</button>
					</Show>
				</fieldset>
			</Show>
			<Show when={statusColorsVisible() && (hasDevices() || hasOutlets())}>
				<StatusLegend devices={hasDevices()} outlets={hasOutlets()} />
			</Show>
			<Show when={allHidden()}>
				<p class="floorplan-hint">
					{t('floorplan.allHidden')}{' '}
					<button
						type="button"
						class="floorplan-link-button"
						onClick={() => showLayers(present().map(({ layer }) => layer))}
					>
						{t('floorplan.showAllLayers')}
					</button>
				</p>
			</Show>
			<Show when={props.empty_hint && present().length === 0}>
				<p class="floorplan-hint">{props.empty_hint}</p>
			</Show>
		</>
	)
}
