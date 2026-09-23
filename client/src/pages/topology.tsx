import { Result } from 'better-result'
import type { TopologyEdge, TopologyNode, TracePath } from 'shared/src/types'
import type { JSX } from 'solid-js'
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from 'solid-js'
import { fetch_trace } from '../api_cables'
import { type DeviceRow, fetch_devices } from '../api_devices'
import { fetch_site_groups, fetch_sites, type SiteGroupRow, type SiteRow } from '../api_tenancy'
import { fetch_cable_trace, fetch_topology } from '../api_topology'
import { navigate, parseId, queryParam } from '../router'

const SVG_W: number = 560
const SVG_H: number = 360
const CX: number = SVG_W / 2
const CY: number = SVG_H / 2
const MIN_VIEW_W: number = 100
const MAX_VIEW_W: number = SVG_W * 3
const ZOOM_FACTOR: number = 1.2

/** Deterministic circular layout: nodes sorted by id around a ring. */
function layout(ids: number[]): Map<number, { x: number; y: number }> {
	const pos = new Map<number, { x: number; y: number }>()
	if (ids.length === 0) {
		return pos
	}
	if (ids.length === 1) {
		pos.set(ids[0] as number, { x: CX, y: CY })
		return pos
	}
	const radius = Math.min(200, 30 * ids.length)
	ids.forEach((id, i) => {
		const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2
		pos.set(id, { x: CX + radius * Math.cos(angle), y: CY + radius * 0.72 * Math.sin(angle) })
	})
	return pos
}

function pathLabel(path: TracePath): string {
	const hops = path.hops.map(
		(h) =>
			`${h.from_device.name}:${h.from_interface.name} → ${h.to_device.name}:${h.to_interface.name}`,
	)
	return hops.join(' · ')
}

/**
 * /topology — device-graph view of L1 cabling: every device is a node,
 * every cable an edge. Site-group/site/focus-device filters narrow the
 * snapshot; clicking a node highlights its direct neighborhood and loads
 * its multi-hop cable trace, clicking an edge loads that cable's trace.
 * The canvas pans on drag and zooms on wheel/buttons.
 */
export function TopologyPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [groupFilter, setGroupFilter] = createSignal(queryParam('group'))
	const [siteFilter, setSiteFilter] = createSignal(queryParam('site'))
	const [focusFilter, setFocusFilter] = createSignal('')
	const [selectedNode, setSelectedNode] = createSignal<number | null>(null)
	const [selectedEdge, setSelectedEdge] = createSignal<number | null>(null)
	const [traceDepth, setTraceDepth] = createSignal('4')
	const [view, setView] = createSignal({ x: 0, y: 0, w: SVG_W, h: SVG_H })

	let svgRef: SVGSVGElement | undefined
	let dragState: {
		pointerId: number
		startX: number
		startY: number
		viewX: number
		viewY: number
		moved: boolean
	} | null = null

	const topoSource = createMemo(() => ({
		group: parseId(groupFilter()) ?? undefined,
		site: parseId(siteFilter()) ?? undefined,
		device: parseId(focusFilter()) ?? undefined,
	}))

	// A new snapshot invalidates node/edge selection and resets the
	// viewport (runs before the deep-link effect below, so deep links
	// re-apply after clearing).
	createEffect(() => {
		topoSource()
		setSelectedNode(null)
		setSelectedEdge(null)
		setView({ x: 0, y: 0, w: SVG_W, h: SVG_H })
	})

	const [siteGroups] = createResource(async () => {
		const res = await fetch_site_groups({ limit: 200 })
		if (Result.isError(res)) {
			return []
		}
		return res.value.items
	})
	const [sites] = createResource(async () => {
		const res = await fetch_sites({ limit: 200 })
		if (Result.isError(res)) {
			return []
		}
		return res.value.items
	})
	const [devices] = createResource(async () => {
		const res = await fetch_devices()
		if (Result.isError(res)) {
			return []
		}
		return res.value.items
	})

	const groupSites = createMemo(() => {
		const g = parseId(groupFilter()) ?? undefined
		const all: SiteRow[] = sites() ?? []
		if (g === undefined) {
			return all
		}
		return all.filter((s) => s.site_group_id === g)
	})
	const filteredDevices = createMemo(() => {
		const g = parseId(groupFilter()) ?? undefined
		const site = parseId(siteFilter()) ?? undefined
		const allSites: SiteRow[] = sites() ?? []
		let all: DeviceRow[] = devices() ?? []
		if (g !== undefined) {
			const siteIds = new Set(allSites.filter((s) => s.site_group_id === g).map((s) => s.id))
			all = all.filter((d) => d.site_id !== null && siteIds.has(d.site_id))
		}
		if (site !== undefined) {
			all = all.filter((d) => d.site_id === site)
		}
		return all
	})

	// Changing the group drops a site choice from another group; changing
	// group/site drops a focus device outside the narrowed snapshot.
	createEffect(() => {
		const g = parseId(groupFilter()) ?? undefined
		const site = parseId(siteFilter())
		if (site !== null) {
			const row = (sites() ?? []).find((s) => s.id === site)
			if (!row || (g !== undefined && row.site_group_id !== g)) {
				setSiteFilter('')
			}
		}
	})
	createEffect(() => {
		const focus = parseId(focusFilter())
		if (focus !== null && !filteredDevices().some((d) => d.id === focus)) {
			const known = (devices() ?? []).some((d) => d.id === focus)
			if (known) {
				setFocusFilter('')
			}
		}
	})

	// Follow device/cable deep links (`/topology?device=<id>`, `?cable=<id>`).
	createEffect(() => {
		const device = parseId(queryParam('device'))
		if (device !== null) {
			setFocusFilter(String(device))
			setSelectedNode(device)
			setSelectedEdge(null)
		}
		const cable = parseId(queryParam('cable'))
		if (cable !== null) {
			setSelectedEdge(cable)
			setSelectedNode(null)
		}
	})

	const [topology, { refetch }] = createResource(topoSource, async (s) => {
		const res = await fetch_topology(s)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const nodes = createMemo(() => topology()?.nodes ?? [])
	const edges = createMemo(() => topology()?.edges ?? [])
	const positions = createMemo(() => layout(nodes().map((n) => n.id)))

	const neighborIds = createMemo(() => {
		const id = selectedNode()
		if (id === null) {
			return null
		}
		const set = new Set<number>([id])
		for (const e of edges()) {
			if (e.a.device.id === id) {
				set.add(e.b.device.id)
			} else if (e.b.device.id === id) {
				set.add(e.a.device.id)
			}
		}
		return set
	})

	const nodeEdges = createMemo(() => {
		const id = selectedNode()
		if (id === null) {
			return []
		}
		return edges().filter((e) => e.a.device.id === id || e.b.device.id === id)
	})

	const traceSource = createMemo(() => ({
		device: selectedNode(),
		depth: Number(traceDepth()) || 4,
	}))
	const [deviceTrace] = createResource(traceSource, async (s) => {
		if (s.device === null) {
			return null
		}
		const res = await fetch_trace(s.device, s.depth)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	const [cableTrace] = createResource(selectedEdge, async (id) => {
		if (id === null) {
			return null
		}
		const res = await fetch_cable_trace(id, Number(traceDepth()) || 4)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	function toggleNode(id: number): void {
		if (dragState?.moved) {
			return
		}
		setError(null)
		setSelectedEdge(null)
		setSelectedNode((prev) => (prev === id ? null : id))
	}

	function toggleEdge(id: number): void {
		if (dragState?.moved) {
			return
		}
		setError(null)
		setSelectedNode(null)
		setSelectedEdge((prev) => (prev === id ? null : id))
	}

	function zoomAt(clientX: number, clientY: number, factor: number): void {
		const svg = svgRef
		if (!svg) {
			return
		}
		const rect = svg.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) {
			return
		}
		const v = view()
		const px = (clientX - rect.left) / rect.width
		const py = (clientY - rect.top) / rect.height
		const svgX = v.x + px * v.w
		const svgY = v.y + py * v.h
		const newW = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, v.w * factor))
		const newH = (newW * SVG_H) / SVG_W
		setView({
			x: svgX - px * newW,
			y: svgY - py * newH,
			w: newW,
			h: newH,
		})
	}

	function zoomCenter(factor: number): void {
		const svg = svgRef
		if (!svg) {
			return
		}
		const rect = svg.getBoundingClientRect()
		zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
	}

	function resetView(): void {
		setView({ x: 0, y: 0, w: SVG_W, h: SVG_H })
	}

	function onPointerDown(e: PointerEvent): void {
		const svg = svgRef
		if (!svg) {
			return
		}
		dragState = {
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			viewX: view().x,
			viewY: view().y,
			moved: false,
		}
		try {
			svg.setPointerCapture(e.pointerId)
		} catch {
			// setPointerCapture is best-effort (mouse already tracks).
		}
	}

	function onPointerMove(e: PointerEvent): void {
		if (!dragState || e.pointerId !== dragState.pointerId) {
			return
		}
		const svg = svgRef
		if (!svg) {
			return
		}
		const dx = e.clientX - dragState.startX
		const dy = e.clientY - dragState.startY
		if (!dragState.moved && Math.hypot(dx, dy) > 4) {
			dragState.moved = true
		}
		if (!dragState.moved) {
			return
		}
		const rect = svg.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) {
			return
		}
		const v = view()
		setView({
			...v,
			x: dragState.viewX - (dx / rect.width) * v.w,
			y: dragState.viewY - (dy / rect.height) * v.h,
		})
	}

	function onPointerUp(e: PointerEvent): void {
		if (!dragState || e.pointerId !== dragState.pointerId) {
			return
		}
		const wasDrag = dragState.moved
		dragState = wasDrag ? { ...dragState, moved: true } : null
		if (!wasDrag) {
			dragState = null
		}
		// Clear the drag-suppression flag after click handlers run.
		if (wasDrag) {
			window.setTimeout(() => {
				dragState = null
			}, 0)
		}
	}

	onMount(() => {
		const svg = svgRef
		if (!svg) {
			return
		}
		const onWheel = (e: WheelEvent): void => {
			e.preventDefault()
			zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR)
		}
		svg.addEventListener('wheel', onWheel, { passive: false })
		onCleanup(() => {
			svg.removeEventListener('wheel', onWheel)
		})
	})

	const zoomPct = createMemo(() => Math.round((SVG_W / view().w) * 100))

	function go(e: MouseEvent, to: string): void {
		e.preventDefault()
		navigate(to)
	}

	return (
		<div>
			<div class="page-header">
				<h2>Topologie</h2>
				<button type="button" onClick={() => refetch()}>
					Aktualisieren
				</button>
			</div>
			<p class="page-subtitle">
				Geräte werden als Knoten und Kabel als Kanten dargestellt. Wählen Sie einen Knoten
				oder ein Kabel, um den Pfad anzuzeigen.
			</p>

			<div class="toolbar-row">
				<label>
					<span class="visually-hidden">Nach Standortgruppe filtern</span>
					<select
						aria-label="Nach Standortgruppe filtern"
						value={groupFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setGroupFilter(e.currentTarget.value)
						}
					>
						<option value="">Alle Gruppen</option>
						<For each={siteGroups() ?? []}>
							{(g: SiteGroupRow): JSX.Element => (
								<option value={g.id}>{g.name}</option>
							)}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Nach Standort filtern</span>
					<select
						aria-label="Nach Standort filtern"
						value={siteFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setSiteFilter(e.currentTarget.value)
						}
					>
						<option value="">Alle Standorte</option>
						<For each={groupSites()}>
							{(s: SiteRow): JSX.Element => <option value={s.id}>{s.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Gerät fokussieren</span>
					<select
						aria-label="Gerät fokussieren"
						value={focusFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setFocusFilter(e.currentTarget.value)
						}
					>
						<option value="">Gesamter Graph</option>
						<For each={filteredDevices()}>
							{(d: DeviceRow): JSX.Element => <option value={d.id}>{d.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Pfadtiefe</span>
					<select
						aria-label="Pfadtiefe"
						value={traceDepth()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setTraceDepth(e.currentTarget.value)
						}
					>
						<For each={['1', '2', '3', '4', '6', '10']}>
							{(d: string): JSX.Element => <option value={d}>Tiefe {d}</option>}
						</For>
					</select>
				</label>
				<span class="toolbar-count" role="status">
					{nodes().length} Geräte · {edges().length} Kabel · {zoomPct()}%
				</span>
			</div>

			<div class="topo-controls" role="toolbar" aria-label="Graph-Ansicht steuern">
				<button
					type="button"
					onClick={() => zoomCenter(1 / ZOOM_FACTOR)}
					aria-label="Vergrößern"
				>
					+
				</button>
				<button
					type="button"
					onClick={() => zoomCenter(ZOOM_FACTOR)}
					aria-label="Verkleinern"
				>
					−
				</button>
				<button type="button" onClick={resetView}>
					Ansicht zurücksetzen
				</button>
				<span class="topo-hint">Ziehen zum Verschieben · Scrollen zum Zoomen</span>
			</div>
			<Show
				when={!topology.loading}
				fallback={<p class="skeleton">Topologie wird geladen…</p>}
			>
				<Show
					when={nodes().length > 0}
					fallback={
						<p class="empty">
							Keine Geräte in dieser Ansicht. Passen Sie den Standortfilter an.
						</p>
					}
				>
					<div class="topo-wrap">
						<svg
							ref={svgRef}
							class="topo-svg topo-pannable"
							viewBox={`${view().x} ${view().y} ${view().w} ${view().h}`}
							role="img"
							aria-label={`Topology graph with ${nodes().length} devices and ${edges().length} cables. Drag to pan, scroll to zoom.`}
							onPointerDown={onPointerDown}
							onPointerMove={onPointerMove}
							onPointerUp={onPointerUp}
							onPointerCancel={onPointerUp}
							onKeyDown={(ev: KeyboardEvent) => {
								if (ev.key === '+' || ev.key === '=') {
									ev.preventDefault()
									zoomCenter(1 / ZOOM_FACTOR)
								} else if (ev.key === '-') {
									ev.preventDefault()
									zoomCenter(ZOOM_FACTOR)
								} else if (ev.key === '0') {
									ev.preventDefault()
									resetView()
								}
							}}
						>
							<For each={edges()}>
								{(e: TopologyEdge): JSX.Element => {
									const a = positions().get(e.a.device.id)
									const b = positions().get(e.b.device.id)
									if (!a || !b) {
										return <g />
									}
									const dimmed =
										neighborIds() !== null &&
										!(
											neighborIds()?.has(e.a.device.id) &&
											neighborIds()?.has(e.b.device.id)
										)
									const active = selectedEdge() === e.cable_id
									return (
										// biome-ignore lint/a11y/useSemanticElements: SVG has no native button — the group carries role="button" with keyboard handling instead
										<g
											role="button"
											tabindex={0}
											aria-label={`Trace cable ${e.a.device.name}:${e.a.iface.name} to ${e.b.device.name}:${e.b.iface.name}`}
											onClick={() => toggleEdge(e.cable_id)}
											onKeyDown={(ev: KeyboardEvent) => {
												if (ev.key === 'Enter' || ev.key === ' ') {
													ev.preventDefault()
													toggleEdge(e.cable_id)
												}
											}}
										>
											<title>{`${e.a.device.name}:${e.a.iface.name} ↔ ${e.b.device.name}:${e.b.iface.name}${e.cable_label ? ` (${e.cable_label})` : ''}`}</title>
											<line
												x1={a.x}
												y1={a.y}
												x2={b.x}
												y2={b.y}
												class={
													active
														? 'topo-edge topo-edge-active'
														: dimmed
															? 'topo-edge topo-dimmed'
															: 'topo-edge'
												}
											/>
										</g>
									)
								}}
							</For>
							<For each={nodes()}>
								{(n: TopologyNode): JSX.Element => {
									const p = positions().get(n.id)
									if (!p) {
										return <g />
									}
									const dimmed =
										neighborIds() !== null && !neighborIds()?.has(n.id)
									const active = selectedNode() === n.id
									return (
										// biome-ignore lint/a11y/useSemanticElements: SVG has no native button — the group carries role="button" with keyboard handling instead
										<g
											class={dimmed ? 'topo-node topo-dimmed' : 'topo-node'}
											onClick={() => toggleNode(n.id)}
											onKeyDown={(ev: KeyboardEvent) => {
												if (ev.key === 'Enter' || ev.key === ' ') {
													ev.preventDefault()
													toggleNode(n.id)
												}
											}}
											tabindex={0}
											role="button"
											aria-label={`Trace from device ${n.name}`}
										>
											<title>{`${n.name} (${n.status})`}</title>
											<circle
												cx={p.x}
												cy={p.y}
												r={active ? 22 : 17}
												class={`topo-circle topo-status-${n.status}`}
											/>
											<text
												x={p.x}
												y={p.y + 34}
												text-anchor="middle"
												class="topo-label"
											>
												{n.name}
											</text>
										</g>
									)
								}}
							</For>
						</svg>
					</div>
				</Show>
			</Show>

			<Show when={selectedNode() !== null}>
				<section class="card" aria-label="Gerätepfad">
					<h3>
						Pfad ab{' '}
						{nodes().find((n) => n.id === selectedNode())?.name ?? selectedNode()} (
						{deviceTrace()?.paths.length ?? 0} Pfade)
					</h3>
					<Show
						when={!deviceTrace.loading}
						fallback={<p class="skeleton">Pfad wird geladen…</p>}
					>
						<Show
							when={(deviceTrace()?.paths ?? []).length > 0}
							fallback={
								<p class="empty">
									Keine Kabelverbindungen jenseits dieses Geräts innerhalb der
									ausgewählten Tiefe.
								</p>
							}
						>
							<ul>
								<For each={deviceTrace()?.paths ?? []}>
									{(p: TracePath) => (
										<li>
											<code>{pathLabel(p)}</code> →{' '}
											<a
												href={`/devices/${p.end_device.id}`}
												onClick={(e: MouseEvent) =>
													go(e, `/devices/${p.end_device.id}`)
												}
											>
												{p.end_device.name}
											</a>
										</li>
									)}
								</For>
							</ul>
						</Show>
					</Show>
					<Show when={nodeEdges().length > 0}>
						<h4>Direkte Kabelverbindungen ({nodeEdges().length})</h4>
						<ul>
							<For each={nodeEdges()}>
								{(e: TopologyEdge): JSX.Element => (
									<li>
										<code>
											{e.a.device.name}:{e.a.iface.name} ↔ {e.b.device.name}:
											{e.b.iface.name}
										</code>{' '}
										{e.cable_label ? <span>({e.cable_label})</span> : null}
									</li>
								)}
							</For>
						</ul>
					</Show>
				</section>
			</Show>

			<Show when={selectedEdge() !== null}>
				<section class="card" aria-label="Kabelpfad">
					<h3>Kabelpfad</h3>
					<Show
						when={!cableTrace.loading}
						fallback={<p class="skeleton">Kabelpfad wird geladen…</p>}
					>
						<Show
							when={cableTrace()}
							fallback={<p class="empty">Kabel nicht gefunden.</p>}
						>
							<p>
								<code>
									{cableTrace()?.a_device.name}:{cableTrace()?.a_interface.name} ↔{' '}
									{cableTrace()?.b_device.name}:{cableTrace()?.b_interface.name}
								</code>{' '}
								{cableTrace()?.cable_label ? (
									<span>({cableTrace()?.cable_label})</span>
								) : null}
							</p>
							<h4>
								Pfade ab {cableTrace()?.a_device.name} (
								{cableTrace()?.paths_from_a.length ?? 0})
							</h4>
							<Show
								when={(cableTrace()?.paths_from_a ?? []).length > 0}
								fallback={<p class="empty">Sackgasse auf dieser Seite.</p>}
							>
								<ul>
									<For each={cableTrace()?.paths_from_a ?? []}>
										{(p: TracePath) => (
											<li>
												<code>{pathLabel(p)}</code>
											</li>
										)}
									</For>
								</ul>
							</Show>
							<h4>
								Pfade ab {cableTrace()?.b_device.name} (
								{cableTrace()?.paths_from_b.length ?? 0})
							</h4>
							<Show
								when={(cableTrace()?.paths_from_b ?? []).length > 0}
								fallback={<p class="empty">Sackgasse auf dieser Seite.</p>}
							>
								<ul>
									<For each={cableTrace()?.paths_from_b ?? []}>
										{(p: TracePath) => (
											<li>
												<code>{pathLabel(p)}</code>
											</li>
										)}
									</For>
								</ul>
							</Show>
						</Show>
					</Show>
				</section>
			</Show>

			<Show when={edges().length > 0}>
				<h3>Kabel ({edges().length})</h3>
				<table>
					<thead>
						<tr>
							<th>Endpunkt A</th>
							<th>Endpunkt B</th>
							<th>Bezeichnung</th>
							<th>Status</th>
							<th>Pfad</th>
						</tr>
					</thead>
					<tbody>
						<For each={edges()}>
							{(e: TopologyEdge): JSX.Element => (
								<tr>
									<td>
										<code>
											{e.a.device.name}:{e.a.iface.name}
										</code>
									</td>
									<td>
										<code>
											{e.b.device.name}:{e.b.iface.name}
										</code>
									</td>
									<td>{e.cable_label ?? '—'}</td>
									<td>
										<span class={`badge badge-${e.cable_status}`}>
											{e.cable_status}
										</span>
									</td>
									<td>
										<button
											type="button"
											onClick={() => toggleEdge(e.cable_id)}
										>
											Anzeigen
										</button>
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</Show>

			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
