import type { ElevationUnit } from 'shared/src/types'
import { For, type JSX, Show } from 'solid-js'
import { navigate } from '../router'

export type RackFace = 'front' | 'rear'

const FACES: RackFace[] = ['front', 'rear']

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** Deterministic hue per device so blocks are distinguishable like NetBox roles. */
export function device_hue(id: number): number {
	return (id * 137 + 29) % 360
}

type RowKind = 'free' | 'shelf' | 'device' | 'ghost'

function row_kind(unit: ElevationUnit, face: RackFace): RowKind {
	if (unit.shelf) {
		return 'shelf'
	}
	if (unit.device) {
		return unit.device.face === null || unit.device.face === face ? 'device' : 'ghost'
	}
	return 'free'
}

function span_label(unit: ElevationUnit): string {
	const device = unit.device
	if (!device) {
		return `U${unit.u}`
	}
	return device.position_u === unit.u && device.u_height === 1
		? `U${unit.u}`
		: `U${unit.u} of U${device.position_u}–U${device.position_u + device.u_height - 1}`
}

/**
 * NetBox-like visual rack elevation with front and rear side by side.
 * Every U is its own single-line row, top-down. Free rows install (select a
 * U, then add a device or shelf); device rows link to the device; shelf rows
 * offer delete. A device mounted on the opposite face renders ghosted, since
 * mount overlap is face-agnostic and the U is not installable from here.
 */
export function RackElevation(props: {
	units: ElevationUnit[]
	selected_u: number | null
	selected_face: RackFace | null
	on_select_u: (u: number, face: RackFace) => void
	on_add_device: (u: number, face: RackFace) => void
	on_delete_shelf: (id: number) => void
}): JSX.Element {
	return (
		<div class="rack-elev-dual">
			<For each={FACES}>
				{(face: RackFace): JSX.Element => (
					<section aria-label={`Rack elevation (${face} face)`}>
						<h4 class="rack-face-title">{face === 'front' ? 'Front' : 'Rear'}</h4>
						<ol class="rack-elev">
							<For each={props.units}>
								{(unit: ElevationUnit): JSX.Element => {
									const kind: RowKind = row_kind(unit, face)
									return (
										<li
											class={`rack-u rack-u-${kind}`}
											classList={{
												'rack-u-selected':
													props.selected_u === unit.u &&
													props.selected_face === face,
											}}
											style={
												kind === 'device' && unit.device
													? {
															'--rack-hue': `${device_hue(unit.device.id)}`,
														}
													: {}
											}
										>
											<span class="rack-u-gutter" aria-hidden="true">
												{unit.u}
											</span>
											<span class="rack-u-body">
												<Show
													when={kind === 'shelf'}
													fallback={
														<Show
															when={kind === 'device'}
															fallback={
																<Show
																	when={kind === 'ghost'}
																	fallback={
																		<div class="rack-free-actions">
																			<button
																				type="button"
																				class="rack-free-btn"
																				aria-label="Select device"
																				title={`Select device at U${unit.u} (${face} face)`}
																				onClick={() =>
																					props.on_select_u(
																						unit.u,
																						face,
																					)
																				}
																			>
																				Select device
																			</button>
																			<button
																				type="button"
																				class="rack-free-btn"
																				aria-label="Add device"
																				title={`Add device at U${unit.u} (${face} face)`}
																				onClick={() =>
																					props.on_add_device(
																						unit.u,
																						face,
																					)
																				}
																			>
																				Add device
																			</button>
																		</div>
																	}
																>
																	<span
																		class="rack-ghost"
																		title="Occupied on the opposite face"
																	>
																		<span class="rack-dev-name">
																			◧ {unit.device?.name}
																		</span>
																		<span class="rack-dev-meta">
																			opposite face
																		</span>
																	</span>
																</Show>
															}
														>
															<a
																href={`/devices/${unit.device?.id ?? ''}`}
																class="rack-dev"
																onClick={(e: MouseEvent): void =>
																	go(
																		e,
																		`/devices/${unit.device?.id ?? ''}`,
																	)
																}
																title={`${unit.device?.name ?? ''} (${unit.device?.device_type_model ?? ''}, ${unit.device?.u_height ?? 1}U)`}
															>
																<span class="rack-dev-name">
																	{unit.device?.name}
																</span>
																<span class="rack-dev-meta">
																	{unit.device?.device_type_model}{' '}
																	· {span_label(unit)}
																</span>
																<Show
																	when={
																		(unit.device?.status ??
																			'active') !== 'active'
																	}
																>
																	<span
																		class={`badge badge-${unit.device?.status}`}
																	>
																		{unit.device?.status}
																	</span>
																</Show>
															</a>
														</Show>
													}
												>
													<span class="rack-shelf">
														<span class="rack-dev-name">
															▤ {unit.shelf?.name}
														</span>
														<span class="rack-dev-meta">shelf</span>
														<button
															type="button"
															class="btn-danger rack-shelf-del"
															aria-label={`Delete shelf ${unit.shelf?.name ?? ''}`}
															onClick={() => {
																if (unit.shelf) {
																	props.on_delete_shelf(
																		unit.shelf.id,
																	)
																}
															}}
														>
															Delete
														</button>
													</span>
												</Show>
											</span>
										</li>
									)
								}}
							</For>
						</ol>
					</section>
				)}
			</For>
		</div>
	)
}
