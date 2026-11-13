/**
 * Object list of a floor plan: every area and marker, grouped by layer (and
 * outlets by panel, like the palette) and filtered by the side panel's search.
 * A row selects its object and focuses the stage on it; in the editor rows
 * also rename areas and delete areas and markers, and Shift + click adds a
 * row to the selection. The same search dims the objects it does not match
 * on the stage (`searchMatches`).
 */
import { IconPencil, IconX } from '@tabler/icons-solidjs'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { FloorplanAreaJson, FloorplanPlacementJson } from '../api/attachments'
import { t, tp } from '../i18n'
import {
	AREA_LAYERS,
	type AreaLayer,
	areaLayer,
	type Layer,
	LayerSwatch,
	layerLabel,
	layerVisible,
	markerLayer,
	showLayer,
} from './floorplan_layers'
import { areaBox, areaName, markerIcon } from './floorplan_stage'
import type { PlanBox, StageZoom } from './zoom_viewport'

/** An object of the plan: area or marker (their ids are separate sequences). */
export type PlanObject = { kind: 'area'; id: number } | { kind: 'marker'; id: number }

interface ObjectRow {
	object: PlanObject
	name: string
	layer: Layer
	area?: FloorplanAreaJson
	placement?: FloorplanPlacementJson
}

interface ObjectGroup {
	key: string
	name: string
	order: number
	rows: ObjectRow[]
}

/** Editing actions of the rows; the view mode has none. */
export interface ObjectListActions {
	rename_area: (id: number, label: string) => void
	delete_area: (id: number) => void
	remove_marker: (id: number) => void
}

export function sameObject(a: PlanObject | null, b: PlanObject | null): boolean {
	return a !== null && b !== null && a.kind === b.kind && a.id === b.id
}

/** Key of an object, for sets of objects. */
export function objectKey(object: PlanObject): string {
	return `${object.kind}:${object.id}`
}

/** A row of the object list with the group it is listed under. */
interface GroupedRow {
	key: string
	name: string
	order: number
	row: ObjectRow
}

/** Every object of the plan as a list row with its group, unfiltered. */
function groupedRows(
	areas: FloorplanAreaJson[],
	placements: FloorplanPlacementJson[],
): GroupedRow[] {
	const rows: GroupedRow[] = []
	for (const area of areas) {
		const layer = areaLayer(area)
		rows.push({
			key: layer,
			name: layerLabel(layer),
			order: AREA_LAYERS.indexOf(layer.slice('area-'.length) as AreaLayer),
			row: { object: { kind: 'area', id: area.id }, name: areaName(area), layer, area },
		})
	}
	for (const placement of placements) {
		const layer = markerLayer(placement)
		const row: ObjectRow = {
			object: { kind: 'marker', id: placement.id },
			name: placement.name,
			layer,
			placement,
		}
		rows.push(
			placement.port
				? {
						key: `port:${placement.port.device_id}`,
						name: t('floorplan.outletsOf', { name: placement.port.device_name }),
						order: 200,
						row,
					}
				: {
						key: layer,
						name: layerLabel(layer),
						order: layer === 'marker-rack' ? 100 : 101,
						row,
					},
		)
	}
	return rows
}

/** True when `search` matches the row's name or its group's. */
function rowMatches(row: GroupedRow, needle: string): boolean {
	return (
		needle === '' ||
		row.row.name.toLowerCase().includes(needle) ||
		row.name.toLowerCase().includes(needle)
	)
}

/** Objects the search matches, as the object list filters them; `null` without a search. */
export function searchMatches(
	areas: FloorplanAreaJson[],
	placements: FloorplanPlacementJson[],
	search: string,
): PlanObject[] | null {
	const needle = search.trim().toLowerCase()
	if (needle === '') {
		return null
	}
	return groupedRows(areas, placements)
		.filter((row: GroupedRow) => rowMatches(row, needle))
		.map((row: GroupedRow) => row.row.object)
}

/** Normalized bounding box of objects, or `null` for none found. */
function objectsBox(
	objects: PlanObject[],
	areas: FloorplanAreaJson[],
	placements: FloorplanPlacementJson[],
): PlanBox | null {
	const xs: number[] = []
	const ys: number[] = []
	for (const object of objects) {
		if (object.kind === 'area') {
			const area = areas.find((a: FloorplanAreaJson) => a.id === object.id)
			for (const [x, y] of area?.points ?? []) {
				xs.push(x)
				ys.push(y)
			}
		} else {
			const placement = placements.find((p: FloorplanPlacementJson) => p.id === object.id)
			if (placement) {
				xs.push(placement.x)
				ys.push(placement.y)
			}
		}
	}
	if (xs.length === 0) {
		return null
	}
	return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/**
 * Focuses the stage on several objects (one is focused like a list row
 * click) and shows their layers.
 */
export function focusObjects(
	zoom: StageZoom,
	objects: PlanObject[],
	areas: FloorplanAreaJson[],
	placements: FloorplanPlacementJson[],
): void {
	if (objects.length === 1) {
		focusObject(zoom, objects[0], areas, placements)
		return
	}
	const box = objectsBox(objects, areas, placements)
	if (!box) {
		return
	}
	for (const object of objects) {
		if (object.kind === 'area') {
			const area = areas.find((a: FloorplanAreaJson) => a.id === object.id)
			if (area) {
				showLayer(areaLayer(area))
			}
		} else {
			const placement = placements.find((p: FloorplanPlacementJson) => p.id === object.id)
			if (placement) {
				showLayer(markerLayer(placement))
			}
		}
	}
	zoom.focus(box)
}

/** Focuses the stage on an object (an area fitted, a marker zoomed in on) and shows its layer. */
export function focusObject(
	zoom: StageZoom,
	object: PlanObject,
	areas: FloorplanAreaJson[],
	placements: FloorplanPlacementJson[],
): void {
	if (object.kind === 'area') {
		const area = areas.find((a: FloorplanAreaJson) => a.id === object.id)
		if (area) {
			showLayer(areaLayer(area))
			zoom.focus(areaBox(area))
		}
		return
	}
	const placement = placements.find((p: FloorplanPlacementJson) => p.id === object.id)
	if (placement) {
		showLayer(markerLayer(placement))
		zoom.focus(
			{ x0: placement.x, y0: placement.y, x1: placement.x, y1: placement.y },
			Math.max(zoom.scale(), 3),
		)
	}
}

export function ObjectList(props: {
	areas: FloorplanAreaJson[]
	placements: FloorplanPlacementJson[]
	search: string
	/** Selected objects; the view selects one at most. */
	selected: PlanObject[]
	/** `add`: Shift + click, to add the row to (or drop it from) the selection. */
	on_select: (object: PlanObject, add: boolean) => void
	actions?: ObjectListActions
}): JSX.Element {
	const [renaming, setRenaming] = createSignal<number | null>(null)
	const isSelected = (object: PlanObject): boolean =>
		props.selected.some((other: PlanObject) => sameObject(other, object))

	const groups = createMemo((): ObjectGroup[] => {
		const needle = props.search.trim().toLowerCase()
		const byKey = new Map<string, ObjectGroup>()
		for (const entry of groupedRows(props.areas, props.placements)) {
			if (!rowMatches(entry, needle)) {
				continue
			}
			const group = byKey.get(entry.key) ?? {
				key: entry.key,
				name: entry.name,
				order: entry.order,
				rows: [],
			}
			group.rows.push(entry.row)
			byKey.set(entry.key, group)
		}
		return [...byKey.values()]
			.map((group: ObjectGroup) => ({
				...group,
				rows: group.rows.sort((a, b) => a.name.localeCompare(b.name)),
			}))
			.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
	})

	return (
		<Show
			when={groups().length > 0}
			fallback={
				<p class="floorplan-hint">
					{props.areas.length + props.placements.length === 0
						? t('floorplan.empty')
						: t('floorplan.objectsNoMatch')}
				</p>
			}
		>
			<For each={groups()}>
				{(group: ObjectGroup) => (
					<section>
						<h5>{group.name}</h5>
						<ul class="floorplan-objects">
							<For each={group.rows}>
								{(row: ObjectRow) => (
									<li
										classList={{
											selected: isSelected(row.object),
											'floorplan-object-hidden': !layerVisible(row.layer),
										}}
									>
										<Show
											when={
												row.area &&
												props.actions &&
												renaming() === row.object.id
											}
											fallback={
												<button
													type="button"
													class="floorplan-object"
													aria-pressed={isSelected(row.object)}
													title={
														layerVisible(row.layer)
															? undefined
															: t('floorplan.objectOnHiddenLayer')
													}
													onClick={(e: MouseEvent) =>
														props.on_select(row.object, e.shiftKey)
													}
												>
													<Show
														when={row.placement}
														fallback={<LayerSwatch layer={row.layer} />}
													>
														{(
															placement: () => FloorplanPlacementJson,
														) => (
															<Dynamic
																component={markerIcon(placement())}
																size={14}
															/>
														)}
													</Show>
													<span>{row.name}</span>
												</button>
											}
										>
											<input
												class="floorplan-object-rename"
												value={row.area?.label ?? ''}
												placeholder={row.area?.target_name}
												maxLength={100}
												aria-label={t('floorplan.areaLabel', {
													name: row.area?.target_name ?? '',
												})}
												ref={(el: HTMLInputElement) =>
													queueMicrotask(() => el.select())
												}
												onKeyDown={(
													e: KeyboardEvent & {
														currentTarget: HTMLInputElement
													},
												) => {
													if (e.key === 'Enter') {
														e.preventDefault()
														e.currentTarget.blur()
													} else if (e.key === 'Escape') {
														e.preventDefault()
														setRenaming(null)
													}
												}}
												// Committed on leaving the field: a live rename would re-sort the list under the cursor.
												onBlur={(
													e: FocusEvent & {
														currentTarget: HTMLInputElement
													},
												) => {
													if (renaming() === row.object.id) {
														props.actions?.rename_area(
															row.object.id,
															e.currentTarget.value,
														)
														setRenaming(null)
													}
												}}
											/>
										</Show>
										<Show when={props.actions}>
											{(actions: () => ObjectListActions) => (
												<>
													<Show when={row.area}>
														<button
															type="button"
															class="floorplan-object-action"
															aria-label={t('floorplan.renameArea', {
																name: row.name,
															})}
															title={t('floorplan.renameArea', {
																name: row.name,
															})}
															onClick={() => {
																props.on_select(row.object, false)
																setRenaming(row.object.id)
															}}
														>
															<IconPencil size={12} />
														</button>
													</Show>
													<button
														type="button"
														class="floorplan-object-action"
														aria-label={
															row.area
																? t('floorplan.deleteAreaNamed', {
																		name: row.name,
																	})
																: t('floorplan.removeMarker', {
																		name: row.name,
																	})
														}
														title={
															row.area
																? t('floorplan.deleteAreaNamed', {
																		name: row.name,
																	})
																: t('floorplan.removeMarker', {
																		name: row.name,
																	})
														}
														onClick={() =>
															row.area
																? actions().delete_area(
																		row.object.id,
																	)
																: actions().remove_marker(
																		row.object.id,
																	)
														}
													>
														<IconX size={12} />
													</button>
												</>
											)}
										</Show>
									</li>
								)}
							</For>
						</ul>
					</section>
				)}
			</For>
		</Show>
	)
}

/**
 * Search field of the side panel. While it matches objects on the plan it
 * shows their count, and Enter zooms the stage to them.
 */
export function PlanSearch(props: {
	value: string
	placeholder: string
	on_input: (value: string) => void
	/** Objects on the plan the search matches; `null` when it does not search the plan. */
	matches: PlanObject[] | null
	on_focus_matches: (matches: PlanObject[]) => void
}): JSX.Element {
	return (
		<>
			<input
				type="search"
				class="floorplan-palette-search"
				placeholder={props.placeholder}
				aria-label={props.placeholder}
				value={props.value}
				onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
					props.on_input(e.currentTarget.value)
				}
				onKeyDown={(e: KeyboardEvent) => {
					const matches = props.matches
					if (e.key === 'Enter' && matches && matches.length > 0) {
						e.preventDefault()
						props.on_focus_matches(matches)
					}
				}}
			/>
			{/* No match: the object list below says so. */}
			<Show when={(props.matches?.length ?? 0) > 0}>
				<p class="floorplan-hint floorplan-search-matches" aria-live="polite">
					{tp('floorplan.searchMatches', props.matches?.length ?? 0)}
				</p>
			</Show>
		</>
	)
}
