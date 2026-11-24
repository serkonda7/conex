/**
 * Symbolic device images: one panel face of a device as SVG, with its ports
 * drawn as connector shapes where `layoutFaceplate` places them. Colours come
 * from CSS (`.faceplate*`), so the image follows the theme; connected ports
 * stand out, disabled ones fade.
 */
import {
	type FaceplateBox,
	type FaceplateCell,
	type FaceplateLayout,
	type FaceplatePort,
	layoutFaceplate,
	type PortShape,
	RACK_UNIT_MM,
} from 'shared/src/faceplate'
import type { PanelFace } from 'shared/src/types'
import { createMemo, For, type JSX, Show } from 'solid-js'
import { t, tp } from '../i18n'
import { faceLabel, portKindLabel } from '../i18n/labels'

/** A port to draw, with its state on a device (a device type's ports have none). */
export interface FaceplateViewPort extends FaceplatePort {
	connected?: boolean
	enabled?: boolean
}

/** Housing outline plus the dark cavity; most connectors are one of these. */
function Housing(props: { w: number; h: number; rx?: number; d?: string }): JSX.Element {
	return (
		<Show
			when={props.d}
			fallback={
				<rect
					class="faceplate-housing"
					width={props.w}
					height={props.h}
					rx={props.rx ?? 0.6}
				/>
			}
		>
			{(d: () => string) => <path class="faceplate-housing" d={d()} />}
		</Show>
	)
}

function Cavity(props: { d: string }): JSX.Element {
	return <path class="faceplate-cavity" d={props.d} />
}

/** Rectangle path inset by `ix`/`iy` (fractions of w and h). */
function inset(w: number, h: number, ix: number, iy: number): string {
	return `M${w * ix},${h * iy}H${w * (1 - ix)}V${h * (1 - iy)}H${w * ix}Z`
}

/** Path through `points` given as fractions of w and h. */
function poly(w: number, h: number, points: [number, number][]): string {
	return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x * w},${y * h}`).join('')}Z`
}

/** Short contact blades of a power connector, at fractions of w and h. */
function Blades(props: { w: number; h: number; at: [number, number][] }): JSX.Element {
	const bw = (): number => Math.max(0.8, props.w * 0.06)
	const bh = (): number => props.h * 0.24
	return (
		<For each={props.at}>
			{([x, y]: [number, number]): JSX.Element => (
				<rect
					class="faceplate-pin"
					x={x * props.w - bw() / 2}
					y={y * props.h - bh() / 2}
					width={bw()}
					height={bh()}
				/>
			)}
		</For>
	)
}

function Dots(props: { w: number; h: number; at: [number, number][]; r: number }): JSX.Element {
	return (
		<For each={props.at}>
			{([x, y]: [number, number]): JSX.Element => (
				<circle class="faceplate-pin" cx={x * props.w} cy={y * props.h} r={props.r} />
			)}
		</For>
	)
}

/** The connector drawing of one shape in a `w` x `h` box at the origin. */
function Socket(props: { shape: PortShape; w: number; h: number }): JSX.Element {
	const w = props.w
	const h = props.h
	const r = Math.min(w, h) / 2
	switch (props.shape) {
		case 'rj45':
		case 'rj11':
			return (
				<>
					<Housing w={w} h={h} />
					<Cavity
						d={poly(w, h, [
							[0.12, 0.14],
							[0.88, 0.14],
							[0.88, 0.68],
							[0.66, 0.68],
							[0.66, 0.88],
							[0.34, 0.88],
							[0.34, 0.68],
							[0.12, 0.68],
						])}
					/>
				</>
			)
		case 'sfp':
		case 'qsfp':
			return (
				<>
					<Housing w={w} h={h} />
					<Cavity d={inset(w, h, 0.08, 0.2)} />
				</>
			)
		case 'usb-a':
			return (
				<>
					<Housing w={w} h={h} rx={0.4} />
					<Cavity d={inset(w, h, 0.08, 0.14)} />
					<rect
						class="faceplate-tongue"
						x={w * 0.16}
						y={h * 0.22}
						width={w * 0.68}
						height={h * 0.3}
					/>
				</>
			)
		case 'usb-b':
			return (
				<>
					<Housing
						w={w}
						h={h}
						d={poly(w, h, [
							[0, 0.3],
							[0.25, 0],
							[0.75, 0],
							[1, 0.3],
							[1, 1],
							[0, 1],
						])}
					/>
					<rect
						class="faceplate-tongue"
						x={w * 0.3}
						y={h * 0.35}
						width={w * 0.4}
						height={h * 0.4}
					/>
				</>
			)
		case 'usb-c':
		case 'usb-mini':
			return (
				<>
					<Housing w={w} h={h} rx={h / 2} />
					<rect
						class="faceplate-tongue"
						x={w * 0.2}
						y={h * 0.38}
						width={w * 0.6}
						height={h * 0.24}
					/>
				</>
			)
		case 'd-sub':
		case 'd-sub-wide':
			return (
				<>
					<Housing
						w={w}
						h={h}
						d={poly(w, h, [
							[0, 0],
							[1, 0],
							[0.9, 1],
							[0.1, 1],
						])}
					/>
					<Dots
						w={w}
						h={h}
						r={Math.min(0.6, h * 0.07)}
						at={[0.22, 0.36, 0.5, 0.64, 0.78].flatMap((x): [number, number][] => [
							[x, 0.35],
							[x + 0.04, 0.65],
						])}
					/>
				</>
			)
		case 'hdmi':
			return (
				<>
					<Housing
						w={w}
						h={h}
						d={poly(w, h, [
							[0, 0],
							[1, 0],
							[1, 0.55],
							[0.86, 1],
							[0.14, 1],
							[0, 0.55],
						])}
					/>
					<rect
						class="faceplate-tongue"
						x={w * 0.14}
						y={h * 0.25}
						width={w * 0.72}
						height={h * 0.25}
					/>
				</>
			)
		case 'displayport':
			return (
				<>
					<Housing
						w={w}
						h={h}
						d={poly(w, h, [
							[0, 0],
							[1, 0],
							[1, 1],
							[0.18, 1],
							[0, 0.6],
						])}
					/>
					<rect
						class="faceplate-tongue"
						x={w * 0.18}
						y={h * 0.32}
						width={w * 0.68}
						height={h * 0.28}
					/>
				</>
			)
		case 'round':
			return (
				<>
					<circle class="faceplate-housing" cx={w / 2} cy={h / 2} r={r} />
					<circle class="faceplate-cavity" cx={w / 2} cy={h / 2} r={r * 0.6} />
				</>
			)
		case 'iec-inlet':
		case 'iec-inlet-large':
			return (
				<>
					<Housing w={w} h={h} rx={1} />
					<Cavity
						d={poly(w, h, [
							[0.14, 0.16],
							[0.86, 0.16],
							[0.86, 0.62],
							[0.7, 0.86],
							[0.3, 0.86],
							[0.14, 0.62],
						])}
					/>
					<Blades
						w={w}
						h={h}
						at={[
							[0.5, 0.34],
							[0.3, 0.62],
							[0.7, 0.62],
						]}
					/>
				</>
			)
		case 'outlet':
		case 'outlet-large':
			return (
				<>
					<Housing w={w} h={h} rx={1} />
					<Cavity
						d={poly(w, h, [
							[0.14, 0.38],
							[0.3, 0.14],
							[0.7, 0.14],
							[0.86, 0.38],
							[0.86, 0.86],
							[0.14, 0.86],
						])}
					/>
					<Blades
						w={w}
						h={h}
						at={[
							[0.5, 0.36],
							[0.32, 0.66],
							[0.68, 0.66],
						]}
					/>
				</>
			)
		case 'iec-small':
			return (
				<>
					<Housing w={w} h={h} rx={h / 2} />
					<Dots
						w={w}
						h={h}
						r={h * 0.14}
						at={[
							[0.32, 0.5],
							[0.68, 0.5],
						]}
					/>
				</>
			)
		case 'schuko':
			return (
				<>
					<circle class="faceplate-housing" cx={w / 2} cy={h / 2} r={r} />
					<circle class="faceplate-cavity" cx={w / 2} cy={h / 2} r={r * 0.78} />
					<Dots
						w={w}
						h={h}
						r={r * 0.09}
						at={[
							[0.32, 0.5],
							[0.68, 0.5],
						]}
					/>
				</>
			)
		case 'terminal':
			return (
				<>
					<Housing w={w} h={h} />
					<Dots
						w={w}
						h={h}
						r={h * 0.26}
						at={[
							[0.28, 0.5],
							[0.72, 0.5],
						]}
					/>
				</>
			)
		case 'mpo':
			return (
				<>
					<Housing w={w} h={h} />
					<Cavity
						d={poly(w, h, [
							[0.1, 0.28],
							[0.42, 0.28],
							[0.42, 0.16],
							[0.58, 0.16],
							[0.58, 0.28],
							[0.9, 0.28],
							[0.9, 0.78],
							[0.1, 0.78],
						])}
					/>
				</>
			)
		case 'punch':
			return (
				<>
					<Housing w={w} h={h} />
					<For each={[0.16, 0.26, 0.36, 0.46, 0.54, 0.64, 0.74, 0.84]}>
						{(x: number): JSX.Element => (
							<rect
								class="faceplate-cavity"
								x={x * w - 0.25}
								y={h * 0.2}
								width={0.5}
								height={h * 0.6}
							/>
						)}
					</For>
				</>
			)
		case 'lc':
		case 'sc':
			return (
				<>
					<Housing w={w} h={h} />
					<Cavity d={inset(w, h, 0.22, 0.18)} />
				</>
			)
		default:
			return (
				<>
					<Housing w={w} h={h} rx={1} />
					<Cavity d={inset(w, h, 0.16, 0.2)} />
				</>
			)
	}
}

function portTitle(port: FaceplateViewPort): string {
	const base = t('faceplate.port', { name: port.name, kind: portKindLabel(port.kind) })
	if (port.enabled === false) {
		return t('faceplate.portState', { port: base, state: t('faceplate.disabled') })
	}
	return port.connected
		? t('faceplate.portState', { port: base, state: t('faceplate.connected') })
		: base
}

/** Label text cut to what fits `width` at `size`. */
function fitText(text: string, width: number, size: number): string {
	const chars = Math.max(1, Math.floor(width / (size * 0.58)))
	return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1))}…`
}

/** Screw holes of the rack ears, one per U at its centre. */
function EarHoles(props: { layout: FaceplateLayout }): JSX.Element {
	const units = (): number[] =>
		Array.from({ length: Math.round(props.layout.height / RACK_UNIT_MM) }, (_, i) => i)
	const ear = (): number => props.layout.panel.x
	return (
		<For each={units()}>
			{(u: number): JSX.Element => (
				<For each={[ear() / 2, props.layout.width - ear() / 2]}>
					{(cx: number): JSX.Element => (
						<rect
							class="faceplate-hole"
							x={cx - 3.2}
							y={u * RACK_UNIT_MM + RACK_UNIT_MM / 2 - 1.7}
							width={6.4}
							height={3.4}
							rx={1.7}
						/>
					)}
				</For>
			)}
		</For>
	)
}

/**
 * One face of a device as a symbolic image. `label` (device or model name)
 * goes on the left of the panel when the ports leave room for it;
 * `hideLabel` keeps that room free for a label the host draws on top.
 */
export function Faceplate(props: {
	ports: readonly FaceplateViewPort[]
	face: PanelFace
	u_height: number
	label?: string
	hideLabel?: boolean
	class?: string
}): JSX.Element {
	const layout = createMemo(
		(): FaceplateLayout =>
			layoutFaceplate(props.ports, props.face, {
				u_height: props.u_height,
				label: props.label !== undefined,
			}),
	)
	const labelSize = (): number => Math.min(7, (layout().label?.h ?? 0) * 0.3)
	return (
		<svg
			class={`faceplate${props.class ? ` ${props.class}` : ''}`}
			viewBox={`0 0 ${layout().width} ${layout().height}`}
			role="img"
			aria-label={t('faceplate.image', {
				face: faceLabel(props.face),
				name: props.label ?? '',
			})}
		>
			<Show
				when={layout().rack}
				fallback={
					<rect
						class="faceplate-panel"
						x={0.5}
						y={0.5}
						width={layout().width - 1}
						height={layout().height - 1}
						rx={4}
					/>
				}
			>
				<rect
					class="faceplate-ear"
					x={0.5}
					y={0.5}
					width={layout().width - 1}
					height={layout().height - 1}
					rx={1}
				/>
				<EarHoles layout={layout()} />
				<rect
					class="faceplate-panel"
					x={layout().panel.x}
					y={0.5}
					width={layout().panel.w}
					height={layout().height - 1}
				/>
			</Show>
			<Show when={props.hideLabel !== true && layout().label}>
				{(box: () => FaceplateBox): JSX.Element => (
					<text
						class="faceplate-label"
						x={box().x}
						y={box().y + box().h / 2}
						dominant-baseline="central"
						font-size={String(labelSize())}
					>
						{fitText(props.label ?? '', box().w, labelSize())}
					</text>
				)}
			</Show>
			<For each={layout().cells}>
				{(cell: FaceplateCell): JSX.Element => {
					const port = (): FaceplateViewPort | undefined => props.ports[cell.index]
					return (
						<g
							class="faceplate-port"
							classList={{
								'faceplate-port-connected': port()?.connected === true,
								'faceplate-port-disabled': port()?.enabled === false,
							}}
							transform={`translate(${cell.x} ${cell.y})`}
						>
							<title>{port() ? portTitle(port() as FaceplateViewPort) : ''}</title>
							<Socket shape={cell.shape} w={cell.w} h={cell.h} />
						</g>
					)
				}}
			</For>
		</svg>
	)
}

/** Front and rear image of a device, each with its caption. */
export function FaceplateViews(props: {
	ports: readonly FaceplateViewPort[]
	u_height: number
	label: string
}): JSX.Element {
	const undrawn = (): number =>
		layoutFaceplate(props.ports, 'front', { u_height: props.u_height }).undrawn +
		layoutFaceplate(props.ports, 'rear', { u_height: props.u_height }).undrawn
	return (
		<div class="faceplate-views">
			<For each={['front', 'rear'] as const}>
				{(face: PanelFace): JSX.Element => (
					<figure class="faceplate-figure">
						<figcaption class="rack-face-title">{faceLabel(face)}</figcaption>
						<Faceplate
							ports={props.ports}
							face={face}
							u_height={props.u_height}
							label={props.label}
						/>
					</figure>
				)}
			</For>
			<Show when={undrawn() > 0}>
				<p class="faceplate-note">{tp('faceplate.undrawn', undrawn())}</p>
			</Show>
		</div>
	)
}
