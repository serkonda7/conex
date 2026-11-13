/**
 * Zoomable viewport for an image and anything drawn on it: the floor plan
 * stage and the attachment lightbox.
 *
 * Zoom is view-only: the stage is scaled and shifted with a CSS transform,
 * so coordinates on it stay normalized (0..1) and pointer mapping through
 * `getBoundingClientRect` of the stage keeps working. Overlay pieces scale
 * back by `--inv-zoom` to keep their screen size.
 *
 * The stage zooms by the buttons in the bar below, Ctrl + wheel and pinch,
 * and pans by a drag while zoomed in. Pieces on the stage that take a press
 * for their own drag still pan with the middle mouse button.
 */
import { IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-solidjs'
import { type Accessor, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js'
import { t } from '../i18n'

/** Zoom range of the stage; 1 fits the whole image. */
const MIN_ZOOM = 1
export const MAX_ZOOM = 8

/** Factor of one zoom button step. */
const ZOOM_STEP = 1.5

/** Pointer travel (px) after which a press on the stage pans instead of clicking. */
const PAN_THRESHOLD = 4

/** Normalized box on the stage. */
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
	/** Normalized center of the visible part of the stage. */
	viewCenter: () => [number, number]
	/** Measures the stage; called by `ZoomViewport`. */
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
				// Keep the same part of the image in view when the layout resizes.
				const ratio = width / before.width
				place(scale(), offset().x * ratio, offset().y * ratio)
			}
		},
	}
	return zoom
}

/** Zoom in / out / fit buttons below the stage. */
function ZoomControls(props: { zoom: StageZoom }): JSX.Element {
	return (
		<div class="zoom-controls" title={t('zoom.hint')}>
			<button
				type="button"
				class="zoom-button"
				aria-label={t('zoom.in')}
				title={t('zoom.in')}
				disabled={props.zoom.scale() >= MAX_ZOOM}
				onClick={() => props.zoom.zoomBy(ZOOM_STEP)}
			>
				<IconZoomIn size={16} />
			</button>
			<button
				type="button"
				class="zoom-button"
				aria-label={t('zoom.out')}
				title={t('zoom.out')}
				disabled={props.zoom.scale() <= MIN_ZOOM}
				onClick={() => props.zoom.zoomBy(1 / ZOOM_STEP)}
			>
				<IconZoomOut size={16} />
			</button>
			<button
				type="button"
				class="zoom-button"
				aria-label={t('zoom.reset')}
				title={t('zoom.reset')}
				disabled={props.zoom.scale() <= MIN_ZOOM}
				onClick={() => props.zoom.reset()}
			>
				<IconZoomReset size={16} />
			</button>
		</div>
	)
}

/**
 * The stage (`children`) in a viewport that zooms and pans, with the zoom
 * buttons and the owner's `bar` items below. The frame is as wide as the
 * stage; `class` on the frame sizes its image.
 */
export function ZoomViewport(props: {
	zoom: StageZoom
	children: JSX.Element
	/** Extra class of the frame. */
	class?: string
	/** Items of the bar below, after the zoom buttons. */
	bar?: JSX.Element
	/** Stage element, to map pointer positions to stage coordinates. */
	ref?: (el: HTMLDivElement) => void
	/** Extra handlers of the stage. */
	handlers?: JSX.HTMLAttributes<HTMLDivElement>
	/** Pointer moves over the viewport, also while not pressed. */
	onPointerMove?: (e: PointerEvent) => void
	onPointerLeave?: () => void
}): JSX.Element {
	let viewport!: HTMLDivElement
	let stage!: HTMLDivElement
	/** Active pointers on the viewport, for pan and pinch. */
	const pointers = new Map<number, { x: number; y: number }>()
	let travelled = 0
	/** A middle-button pan is in progress. */
	const [forcedPan, setForcedPan] = createSignal(false)
	const zoomed = (): boolean => props.zoom.scale() > MIN_ZOOM

	const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
		const box = viewport.getBoundingClientRect()
		return { x: e.clientX - box.left, y: e.clientY - box.top }
	}

	/** Presses inside an open popover on the stage are its own. */
	const inPopover = (e: Event): boolean =>
		(e.target as Element).closest('.floorplan-popover') !== null

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
		if (inPopover(e)) {
			return
		}
		if (e.pointerType === 'mouse' && e.button !== 0) {
			return
		}
		if (pointers.size === 0) {
			travelled = 0
		}
		pointers.set(e.pointerId, local(e))
		if (zoomed() || pointers.size > 1) {
			// No text selection or native link / image drag while panning.
			e.preventDefault()
		}
	}

	/**
	 * Capture phase, ahead of drag handlers on the stage: a middle-button
	 * press pans instead of reaching the piece below.
	 */
	const onPointerDownCapture = (e: PointerEvent): void => {
		const middle = e.pointerType === 'mouse' && e.button === 1
		if (!zoomed() || !middle || inPopover(e)) {
			return
		}
		e.preventDefault()
		e.stopPropagation()
		pointers.set(e.pointerId, local(e))
		// Pans from the first move; the click after release is swallowed.
		travelled = PAN_THRESHOLD
		setForcedPan(true)
	}

	const onWindowPointerMove = (e: PointerEvent): void => {
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
		} else if (zoomed()) {
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

	// A press that panned does not also click the piece below.
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
		window.addEventListener('pointermove', onWindowPointerMove)
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
			window.removeEventListener('pointermove', onWindowPointerMove)
			window.removeEventListener('pointerup', onPointerUp)
			window.removeEventListener('pointercancel', onPointerUp)
		})
	})

	return (
		<div class={props.class ? `zoom-frame ${props.class}` : 'zoom-frame'}>
			<div
				class="zoom-viewport"
				classList={{ zoomed: zoomed() }}
				ref={viewport}
				onPointerDown={onPointerDown}
				onPointerMove={(e: PointerEvent) => props.onPointerMove?.(e)}
				onPointerLeave={() => props.onPointerLeave?.()}
			>
				<div
					class="zoom-stage"
					ref={(el: HTMLDivElement) => {
						stage = el
						props.ref?.(el)
					}}
					style={{
						transform: `translate(${props.zoom.offset().x}px, ${props.zoom.offset().y}px) scale(${props.zoom.scale()})`,
						'--inv-zoom': String(1 / props.zoom.scale()),
					}}
					{...props.handlers}
				>
					{props.children}
				</div>
				<Show when={forcedPan()}>
					<div class="zoom-pan-cover" />
				</Show>
			</div>
			<div class="zoom-bar">
				<ZoomControls zoom={props.zoom} />
				{props.bar}
			</div>
		</div>
	)
}
