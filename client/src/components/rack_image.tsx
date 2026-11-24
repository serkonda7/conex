/**
 * Symbolic front view of an empty rack: the 19" bay with its rails and the
 * EIA hole pattern, U numbers on the left. Cabinets get side walls, a vented
 * top and a plinth; frames show the bare posts. Drawn in mm like the device
 * faceplates (`components/faceplate.tsx`), coloured by CSS (`.rack-image*`).
 */
import { RACK_UNIT_MM, RACK_WIDTH_MM } from 'shared/src/faceplate'
import { For, type JSX, Show } from 'solid-js'
import { t } from '../i18n'
import { formFactorLabel } from '../i18n/labels'

/** Gutter for the U numbers. */
const GUTTER_MM = 30
/** Width of one mounting rail (behind the device ears). */
const RAIL_MM = 16
/** EIA-310 holes of one U, from its bottom edge. */
const HOLE_OFFSETS_MM = [6.35, 22.225, 38.1]
const HOLE_MM = 3.6

interface Frame {
	/** Side wall or post width outside the rails. */
	side: number
	top: number
	bottom: number
	cabinet: boolean
}

function frameOf(formFactor: string | undefined): Frame {
	return formFactor?.endsWith('cabinet')
		? { side: 18, top: 36, bottom: 26, cabinet: true }
		: { side: 8, top: 12, bottom: 18, cabinet: false }
}

/** Front view of an empty rack of `u_height` units. */
export function RackImage(props: { u_height: number; form_factor?: string }): JSX.Element {
	const frame = (): Frame => frameOf(props.form_factor)
	const bayX = (): number => GUTTER_MM + frame().side
	const bayH = (): number => props.u_height * RACK_UNIT_MM
	const width = (): number => bayX() + RACK_WIDTH_MM + frame().side
	const height = (): number => frame().top + bayH() + frame().bottom
	/** Top edge of unit `u` (1 = bottom unit). */
	const unitTop = (u: number): number => frame().top + (props.u_height - u) * RACK_UNIT_MM
	const units = (): number[] => Array.from({ length: props.u_height }, (_, i) => i + 1)
	const rails = (): number[] => [bayX(), bayX() + RACK_WIDTH_MM - RAIL_MM]
	return (
		<svg
			class="rack-image"
			viewBox={`0 0 ${width()} ${height()}`}
			role="img"
			aria-label={t('rackType.image', {
				height: props.u_height,
				formFactor: props.form_factor ? formFactorLabel(props.form_factor) : '',
			})}
		>
			<rect
				class={frame().cabinet ? 'rack-image-cabinet' : 'rack-image-post'}
				x={GUTTER_MM}
				y={0}
				width={width() - GUTTER_MM}
				height={height()}
				rx={frame().cabinet ? 3 : 1}
			/>
			<Show when={frame().cabinet}>
				<For each={Array.from({ length: 12 }, (_, i) => i)}>
					{(i: number): JSX.Element => (
						<rect
							class="rack-image-vent"
							x={bayX() + 60 + i * 30}
							y={frame().top / 2 - 3}
							width={20}
							height={6}
							rx={3}
						/>
					)}
				</For>
			</Show>
			<rect
				class="rack-image-bay"
				x={bayX()}
				y={frame().top}
				width={RACK_WIDTH_MM}
				height={bayH()}
			/>
			<For each={units()}>
				{(u: number): JSX.Element => (
					<>
						<line
							class="rack-image-unit"
							x1={bayX() + RAIL_MM}
							x2={bayX() + RACK_WIDTH_MM - RAIL_MM}
							y1={unitTop(u)}
							y2={unitTop(u)}
						/>
						<text
							class="rack-image-number"
							x={GUTTER_MM - 6}
							y={unitTop(u) + RACK_UNIT_MM / 2}
							text-anchor="end"
							dominant-baseline="central"
							font-size="16"
						>
							{u}
						</text>
					</>
				)}
			</For>
			<For each={rails()}>
				{(x: number): JSX.Element => (
					<>
						<rect
							class="rack-image-rail"
							x={x}
							y={frame().top}
							width={RAIL_MM}
							height={bayH()}
						/>
						<For each={units()}>
							{(u: number): JSX.Element => (
								<For each={HOLE_OFFSETS_MM}>
									{(offset: number): JSX.Element => (
										<rect
											class="rack-image-hole"
											x={x + (RAIL_MM - HOLE_MM) / 2}
											y={unitTop(u) + RACK_UNIT_MM - offset - HOLE_MM / 2}
											width={HOLE_MM}
											height={HOLE_MM}
										/>
									)}
								</For>
							)}
						</For>
					</>
				)}
			</For>
		</svg>
	)
}
