/**
 * 3D view of a drawn floor plan, the view's alternative to the 2D stage:
 * the scene of `drawn_plan_scene.ts` under an orbiting camera, with the
 * markers and the room and desk labels as HTML on top, so they keep their
 * screen size and link like on the 2D plan. Loaded on demand with three.js.
 *
 * Drag rotates, right-drag or Shift + drag pans, Ctrl + wheel and pinch
 * zoom (a plain wheel scrolls the page, like on the 2D stage). The view
 * renders only when something changed.
 */
import { IconFocus2 } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js'
import {
	AmbientLight,
	Color,
	DirectionalLight,
	HemisphereLight,
	type Object3D,
	PerspectiveCamera,
	Raycaster,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { FloorplanDrawingJson } from '../api/floorplan_drawings'
import { t } from '../i18n'
import type { PlanLabel } from './drawn_plan'
import type { Point } from './drawn_plan_geometry'
import {
	buildPlanScene,
	markerHeight,
	type PlanScene,
	type SceneColors,
	tallestWall,
	worldPoint,
} from './drawn_plan_scene'
import { isOutlet, type OutletPlacement, OutletPopover } from './floorplan_outlet'
import { MarkerGlyph, MarkerName, markerClasses, markerHref, markerTitle } from './floorplan_stage'

/** Vertical field of view, degrees. */
const FOV = 45

/** Quiet time (ms) after the last frame before hidden markers and labels are dimmed. */
const REST_DELAY = 150

/** Camera movement per frame, relative to its distance, below which it counts as resting. */
const SETTLED = 1e-4

/** Camera elevation of the starting view, degrees above the floor. */
const START_ELEVATION = 55

/** The camera stays this far (degrees) above the floor. */
const MIN_ELEVATION = 5

/** The theme's colors under `host`, as colors three.js can read. */
function sceneColors(host: HTMLElement): SceneColors {
	const probe = document.createElement('span')
	probe.hidden = true
	host.append(probe)
	// A canvas normalizes every CSS color syntax (also `color(srgb …)`) to hex or rgba.
	const context = document.createElement('canvas').getContext('2d')
	const color = (name: string): string => {
		probe.style.color = `var(${name})`
		const computed = getComputedStyle(probe).color
		if (!context) {
			return computed
		}
		context.fillStyle = computed
		return context.fillStyle
	}
	const link = new Color(color('--link'))
	const raised = new Color(color('--bg-raised'))
	const colors: SceneColors = {
		background: color('--bg-raised'),
		floor: color('--bg-surface'),
		wall: color('--text-secondary'),
		door: color('--text-muted'),
		glass: color('--link'),
		room: color('--link'),
		stair: color('--bg-hover'),
		tray: color('--warning'),
		desk: color('--bg-raised'),
		deskLinked: `#${raised.clone().lerp(link, 0.25).getHexString()}`,
		rack: color('--border-strong'),
		pole: color('--text-muted'),
		edge: color('--text-secondary'),
	}
	probe.remove()
	return colors
}

/** An outlet's open popover, at its marker in fractions of the view (0..1). */
interface OpenOutlet {
	placement: OutletPlacement
	x: number
	y: number
}

/** Everything the view sets up once its container is in the page. */
interface Viewer {
	renderer: WebGLRenderer
	labels: CSS2DRenderer
	scene: Scene
	camera: PerspectiveCamera
	controls: OrbitControls
	render: () => void
	/** Runs once the camera came to rest after rendering. */
	on_rest: (() => void) | null
	dispose: () => void
}

function createViewer(host: HTMLDivElement, background: string): Result<Viewer, Error> {
	const created = Result.try({
		try: () => new WebGLRenderer({ antialias: true }),
		catch: () => new Error(t('drawnPlan.noWebgl')),
	})
	if (Result.isError(created)) {
		return created
	}
	const renderer = created.value
	renderer.setPixelRatio(window.devicePixelRatio)
	renderer.localClippingEnabled = true
	renderer.domElement.classList.add('drawn-plan-3d-canvas')
	host.append(renderer.domElement)

	const labels = new CSS2DRenderer()
	labels.domElement.classList.add('drawn-plan-3d-labels')
	host.append(labels.domElement)

	const scene = new Scene()
	scene.background = new Color(background)
	scene.add(new HemisphereLight(0xffffff, 0x444444, 1.4))
	scene.add(new AmbientLight(0xffffff, 0.4))
	const sun = new DirectionalLight(0xffffff, 1.6)
	sun.position.set(-0.6, 1, 0.45)
	scene.add(sun)

	const camera = new PerspectiveCamera(FOV, 1, 1, 10)
	// A plain wheel scrolls the page; only Ctrl + wheel reaches the controls and zooms.
	const passWheel = (e: WheelEvent): void => {
		if (!e.ctrlKey && !e.metaKey) {
			e.stopImmediatePropagation()
		}
	}
	renderer.domElement.addEventListener('wheel', passWheel, { capture: true })
	const controls = new OrbitControls(camera, renderer.domElement)
	controls.enableDamping = true
	controls.dampingFactor = 0.1
	controls.maxPolarAngle = ((90 - MIN_ELEVATION) * Math.PI) / 180
	controls.screenSpacePanning = false

	let frame = 0
	let rest: ReturnType<typeof setTimeout> | undefined
	const before = new Vector3()
	const draw = (): void => {
		frame = 0
		before.copy(camera.position)
		// Damping keeps the camera moving after a drag: render until it stops.
		const moving = controls.update()
		renderer.render(scene, camera)
		labels.render(scene, camera)
		// Damping fades out slowly: the camera rests once it barely moves.
		const settled =
			!moving || camera.position.distanceTo(before) < controls.getDistance() * SETTLED
		if (!settled) {
			clearTimeout(rest)
			rest = undefined
		} else if (rest === undefined) {
			rest = setTimeout(() => {
				rest = undefined
				viewer.on_rest?.()
			}, REST_DELAY)
		}
		if (moving) {
			render()
		}
	}
	const render = (): void => {
		if (frame === 0) {
			frame = requestAnimationFrame(draw)
		}
	}
	controls.addEventListener('change', render)

	const resize = new ResizeObserver(() => {
		const { clientWidth: width, clientHeight: height } = host
		if (width === 0 || height === 0) {
			return
		}
		renderer.setSize(width, height)
		labels.setSize(width, height)
		camera.aspect = width / height
		camera.updateProjectionMatrix()
		render()
	})
	resize.observe(host)

	const viewer: Viewer = {
		renderer,
		labels,
		scene,
		camera,
		controls,
		render,
		on_rest: null,
		dispose: () => {
			cancelAnimationFrame(frame)
			clearTimeout(rest)
			resize.disconnect()
			controls.dispose()
			renderer.domElement.removeEventListener('wheel', passWheel, { capture: true })
			renderer.dispose()
			renderer.forceContextLoss()
			renderer.domElement.remove()
			labels.domElement.remove()
		},
	}
	return Result.ok(viewer)
}

/** Points the camera at the sheet's center from the south, the whole sheet in view. */
function frameSheet(viewer: Viewer, sheet: FloorplanDrawingJson): void {
	const { camera, controls } = viewer
	const walls = tallestWall(sheet)
	const extent = Math.max(sheet.width, sheet.height)
	const half = (FOV * Math.PI) / 360
	const elevation = (START_ELEVATION * Math.PI) / 180
	// Seen from above at an angle, the sheet's depth and the walls' height share the frame's height.
	const span = Math.max(
		sheet.height * Math.sin(elevation) + walls * Math.cos(elevation),
		sheet.width / Math.max(0.1, camera.aspect),
	)
	const reach = (span / 2 / Math.tan(half)) * 1.1
	controls.target.set(sheet.width / 2, 0, sheet.height / 2)
	camera.position.set(
		sheet.width / 2,
		Math.sin(elevation) * reach,
		sheet.height / 2 + Math.cos(elevation) * reach,
	)
	camera.near = Math.max(1, extent / 5000)
	camera.far = extent * 20 + walls * 10
	camera.updateProjectionMatrix()
	controls.minDistance = 50
	controls.maxDistance = extent * 6
	controls.update()
	viewer.render()
}

/**
 * The 3D view: the canvas with the markers and `labels` on top and the
 * bar below with Reset view and the owner's `bar` items (the mode toggle).
 */
export default function DrawnPlan3D(props: {
	drawing: FloorplanDrawingJson
	labels: PlanLabel[]
	/** Opacity of the reference image, 0..1; `null` hides it. */
	reference_opacity: number | null
	bar: JSX.Element
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [outlet, setOutlet] = createSignal<OpenOutlet | null>(null)
	let host: HTMLDivElement | undefined
	let viewer: Viewer | undefined
	const [ready, setReady] = createSignal(false)
	/** What hides the markers and labels behind it, and the pinned markers and labels. */
	let occluders: Object3D[] = []
	let pins: CSS2DObject[] = []

	/** Dims the markers and labels the walls hide from the camera. */
	const dimHidden = (): void => {
		if (!viewer) {
			return
		}
		const eye = viewer.camera.position
		const ray = new Raycaster()
		const at = new Vector3()
		for (const pin of pins) {
			pin.getWorldPosition(at)
			const length = at.distanceTo(eye)
			ray.set(eye, at.sub(eye).normalize())
			ray.far = Math.max(0, length - 1)
			const hidden = ray.intersectObjects(occluders, false).length > 0
			pin.element.classList.toggle('drawn-plan-3d-hidden', hidden)
		}
	}

	onMount(() => {
		if (!host) {
			return
		}
		const created = createViewer(host, sceneColors(host).background)
		if (Result.isError(created)) {
			setError(created.error.message)
			return
		}
		viewer = created.value
		viewer.on_rest = dimHidden
		// Moving the camera leaves an open outlet popover behind its marker: close it.
		viewer.controls.addEventListener('start', () => setOutlet(null))
		setReady(true)
		frameSheet(viewer, props.drawing)
	})
	onCleanup(() => viewer?.dispose())

	/** Opens the popover of `placement` under its marker `el`. */
	const openOutlet = (placement: OutletPlacement, el: HTMLElement): void => {
		const box = host?.getBoundingClientRect()
		const at = el.getBoundingClientRect()
		if (!box || box.width === 0 || box.height === 0) {
			return
		}
		setOutlet({
			placement,
			x: (at.left + at.width / 2 - box.left) / box.width,
			y: (at.top + at.height / 2 - box.top) / box.height,
		})
	}

	// The scene: rebuilt when the plan or the reference image's visibility changes.
	createEffect(() => {
		if (!ready() || !viewer || !host) {
			return
		}
		const current = viewer
		const built: PlanScene = buildPlanScene(
			props.drawing,
			sceneColors(host),
			props.reference_opacity === null
				? null
				: { opacity: props.reference_opacity, on_load: () => current.render() },
		)
		current.scene.add(built.root)
		occluders = built.occluders
		current.render()
		onCleanup(() => {
			occluders = []
			current.scene.remove(built.root)
			built.dispose()
			current.render()
		})
	})

	// Markers and labels as HTML pinned to the scene.
	createEffect(() => {
		if (!ready() || !viewer) {
			return
		}
		const current = viewer
		const pinned: CSS2DObject[] = []
		const pin = (el: HTMLElement, at: Point, height: number): void => {
			const object = new CSS2DObject(el)
			object.position.copy(worldPoint(at, height))
			current.scene.add(object)
			pinned.push(object)
		}
		for (const label of props.labels) {
			const classList = { 'drawn-plan-name-desk': label.kind === 'desk' }
			const el = (
				label.location_id === null ? (
					<span class="drawn-plan-name" classList={classList}>
						{label.text}
					</span>
				) : (
					<a
						href={`/locations/${label.location_id}`}
						class="drawn-plan-name"
						classList={classList}
						title={label.text}
						draggable={false}
					>
						{label.text}
					</a>
				)
			) as HTMLElement
			pin(el, label.at, label.height + 2)
		}
		for (const placement of props.drawing.placements) {
			const outletPlacement = isOutlet(placement) ? placement : null
			const glyph = (): JSX.Element => (
				<>
					<MarkerGlyph placement={placement} size={16} />
					<MarkerName placement={placement} />
				</>
			)
			const el = (
				outletPlacement ? (
					<button
						type="button"
						class="floorplan-marker"
						classList={markerClasses(placement)}
						title={markerTitle(placement)}
						aria-label={markerTitle(placement)}
						onClick={(e: MouseEvent): void =>
							openOutlet(outletPlacement, e.currentTarget as HTMLElement)
						}
					>
						{glyph()}
					</button>
				) : (
					<a
						href={markerHref(placement)}
						class="floorplan-marker"
						classList={markerClasses(placement)}
						title={markerTitle(placement)}
						aria-label={markerTitle(placement)}
						draggable={false}
					>
						{glyph()}
					</a>
				)
			) as HTMLElement
			pin(el, [placement.x, placement.y], markerHeight(placement))
		}
		pins = pinned
		current.render()
		onCleanup(() => {
			pins = []
			for (const object of pinned) {
				current.scene.remove(object)
				object.element.remove()
			}
			current.render()
		})
	})

	return (
		<div class="drawn-plan-3d-frame">
			<Show when={error() === null} fallback={<p class="floorplan-hint">{error()}</p>}>
				<div class="drawn-plan-3d" ref={host}>
					<Show when={outlet()}>
						{(open: () => OpenOutlet): JSX.Element => (
							<div class="drawn-plan-3d-popover">
								<OutletPopover
									placement={{ ...open().placement, x: open().x, y: open().y }}
									on_close={(): void => {
										setOutlet(null)
									}}
								/>
							</div>
						)}
					</Show>
				</div>
			</Show>
			<div class="zoom-bar">
				<Show when={error() === null}>
					<button
						type="button"
						class="zoom-button"
						title={t('drawnPlan.resetView')}
						aria-label={t('drawnPlan.resetView')}
						onClick={(): void => {
							setOutlet(null)
							if (viewer) {
								frameSheet(viewer, props.drawing)
							}
						}}
					>
						<IconFocus2 size={16} aria-hidden="true" />
					</button>
				</Show>
				{props.bar}
				<Show when={error() === null}>
					<span class="drawn-plan-3d-hint">{t('drawnPlan.hint3d')}</span>
				</Show>
			</div>
		</div>
	)
}
