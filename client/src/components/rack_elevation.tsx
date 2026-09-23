import type { DeviceFace, ElevationDeviceRef, ElevationUnit } from 'shared/src/types'
import { For, type JSX, Show } from 'solid-js'
import { navigate } from '../router'

export type RackFace = DeviceFace

const FACES: RackFace[] = ['front', 'rear']

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

type RowKind = 'free' | 'shelf' | 'device' | 'ghost'

function device_for_face(unit: ElevationUnit, face: RackFace): ElevationDeviceRef | undefined {
	const devices = unit.devices ?? (unit.device ? [unit.device] : [])
	return devices.find((device) => device.face === face || device.face === null) ?? devices[0]
}

function row_kind(unit: ElevationUnit, face: RackFace): RowKind {
	if (unit.shelf) {
		return 'shelf'
	}
	const device = device_for_face(unit, face)
	if (device) {
		return device.face === null || device.face === face || device.is_full_depth
			? 'device'
			: 'free'
	}
	return 'free'
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
	on_select_device: (u: number, face: RackFace) => void
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
									const device = device_for_face(unit, face)
									return (
										<li
											class={`rack-u rack-u-${kind}`}
											classList={{
												'rack-u-selected':
													props.selected_u === unit.u &&
													props.selected_face === face,
											}}
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
																				onClick={() => {
																					props.on_select_u(
																						unit.u,
																						face,
																					)
																					props.on_select_device(
																						unit.u,
																						face,
																					)
																				}}
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
																			◧ {device?.name}
																		</span>
																		<span class="rack-dev-meta">
																			opposite face
																		</span>
																	</span>
																</Show>
															}
														>
															<a
																href={`/devices/${device?.id ?? ''}`}
																class="rack-dev"
																onClick={(e: MouseEvent): void =>
																	go(
																		e,
																		`/devices/${device?.id ?? ''}`,
																	)
																}
																title={`${device?.name ?? ''} (${device?.device_type_model ?? ''}, ${device?.u_height ?? 1}U)`}
															>
																<span class="rack-dev-name">
																	{device?.name}
																</span>
																<span class="rack-dev-meta">
																	{device?.device_type_model}
																</span>
																<Show
																	when={
																		(device?.status ??
																			'active') !== 'active'
																	}
																>
																	<span
																		class={`badge badge-${device?.status}`}
																	>
																		{device?.status}
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
