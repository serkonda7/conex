/**
 * Object list of a floor plan: every area and marker, grouped by layer (and
 * outlets by panel, like the palette) and filtered by the side panel's search.
 * A row selects its object and focuses the stage on it; in the editor rows
 * also rename areas and delete areas and markers.
 */
import { IconPencil, IconX } from '@tabler/icons-solidjs'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import type { FloorplanAreaJson, FloorplanPlacementJson } from '../api/attachments'
import { t } from '../i18n'
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
import { areaBox, areaName, markerIcon, type StageZoom } from './floorplan_stage'

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
	selected: PlanObject | null
	on_select: (object: PlanObject) => void
	actions?: ObjectListActions
}): JSX.Element {
	const [renaming, setRenaming] = createSignal<number | null>(null)

	const groups = createMemo((): ObjectGroup[] => {
		const needle = props.search.trim().toLowerCase()
		const byKey = new Map<string, ObjectGroup>()
		const add = (key: string, name: string, order: number, row: ObjectRow): void => {
			if (
				needle &&
				!row.name.toLowerCase().includes(needle) &&
				!name.toLowerCase().includes(needle)
			) {
				return
			}
			const group = byKey.get(key) ?? { key, name, order, rows: [] }
			group.rows.push(row)
			byKey.set(key, group)
		}
		for (const area of props.areas) {
			const layer = areaLayer(area)
			add(
				layer,
				layerLabel(layer),
				AREA_LAYERS.indexOf(layer.slice('area-'.length) as AreaLayer),
				{
					object: { kind: 'area', id: area.id },
					name: areaName(area),
					layer,
					area,
				},
			)
		}
		for (const placement of props.placements) {
			const layer = markerLayer(placement)
			const row: ObjectRow = {
				object: { kind: 'marker', id: placement.id },
				name: placement.name,
				layer,
				placement,
			}
			if (placement.port) {
				add(
					`port:${placement.port.device_id}`,
					t('floorplan.outletsOf', { name: placement.port.device_name }),
					200,
					row,
				)
			} else {
				add(layer, layerLabel(layer), layer === 'marker-rack' ? 100 : 101, row)
			}
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
											selected: sameObject(props.selected, row.object),
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
													aria-pressed={sameObject(
														props.selected,
														row.object,
													)}
													title={
														layerVisible(row.layer)
															? undefined
															: t('floorplan.objectOnHiddenLayer')
													}
													onClick={() => props.on_select(row.object)}
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
																props.on_select(row.object)
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
