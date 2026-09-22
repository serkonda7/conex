import { Result } from 'better-result'
import type { TopologyEdge, TopologyNode, TracePath } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { fetch_sites, type SiteRow } from '../api_p1'
import { type DeviceRow, fetch_devices } from '../api_p4'
import { fetch_trace } from '../api_p5'
import { fetch_cable_trace, fetch_topology } from '../api_topology'
import { navigate, parseId, queryParam } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

const SVG_W: number = 800
const SVG_H: number = 520
const CX: number = SVG_W / 2
const CY: number = SVG_H / 2

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
	const radius = Math.min(300, 34 * ids.length)
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
 * every cable an edge. Site/focus-device filters narrow the snapshot;
 * clicking a node highlights its direct neighborhood and loads its
 * multi-hop cable trace, clicking an edge loads that cable's trace.
 */
export function TopologyPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [siteFilter, setSiteFilter] = createSignal('')
	const [focusFilter, setFocusFilter] = createSignal('')
	const [selectedNode, setSelectedNode] = createSignal<number | null>(null)
	const [selectedEdge, setSelectedEdge] = createSignal<number | null>(null)
	const [traceDepth, setTraceDepth] = createSignal('4')

	const topoSource = createMemo(() => ({
		site: parseId(siteFilter()) ?? undefined,
		device: parseId(focusFilter()) ?? undefined,
	}))

	// A new snapshot invalidates node/edge selection (runs before the
	// deep-link effect below, so deep links re-apply after clearing).
	createEffect(() => {
		topoSource()
		setSelectedNode(null)
		setSelectedEdge(null)
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
		setError(null)
		setSelectedEdge(null)
		setSelectedNode((prev) => (prev === id ? null : id))
	}

	function toggleEdge(id: number): void {
		setError(null)
		setSelectedNode(null)
		setSelectedEdge((prev) => (prev === id ? null : id))
	}

	return (
		<div>
			<div class="page-header">
				<h2>Topology</h2>
				<button type="button" onClick={() => refetch()}>
					Refresh
				</button>
			</div>
			<p class="page-subtitle">
				Devices as nodes, cables as edges. Select a node or cable for its trace.
			</p>

			<div class="toolbar-row">
				<label>
					<span class="visually-hidden">Filter by site</span>
					<select
						aria-label="Filter by site"
						value={siteFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setSiteFilter(e.currentTarget.value)
						}
					>
						<option value="">Any site</option>
						<For each={sites() ?? []}>
							{(s: SiteRow): JSX.Element => <option value={s.id}>{s.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Focus on device</span>
					<select
						aria-label="Focus on device"
						value={focusFilter()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setFocusFilter(e.currentTarget.value)
						}
					>
						<option value="">Whole graph</option>
						<For each={devices() ?? []}>
							{(d: DeviceRow): JSX.Element => <option value={d.id}>{d.name}</option>}
						</For>
					</select>
				</label>
				<label>
					<span class="visually-hidden">Trace depth</span>
					<select
						aria-label="Trace depth"
						value={traceDepth()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setTraceDepth(e.currentTarget.value)
						}
					>
						<For each={['1', '2', '3', '4', '6', '10']}>
							{(d: string): JSX.Element => <option value={d}>Depth {d}</option>}
						</For>
					</select>
				</label>
				<span class="toolbar-count" role="status">
					{nodes().length} devices · {edges().length} cables
				</span>
			</div>

			<Show when={!topology.loading} fallback={<p class="skeleton">Loading topology…</p>}>
				<Show
					when={nodes().length > 0}
					fallback={<p class="empty">No devices in this view. Adjust the site filter.</p>}
				>
					<div class="topo-wrap">
						<svg
							class="topo-svg"
							viewBox={`0 0 ${SVG_W} ${SVG_H}`}
							role="img"
							aria-label={`Topology graph with ${nodes().length} devices and ${edges().length} cables`}
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
				<section class="card" aria-label="Device trace">
					<h3>
						Trace from{' '}
						{nodes().find((n) => n.id === selectedNode())?.name ?? selectedNode()} (
						{deviceTrace()?.paths.length ?? 0} paths)
					</h3>
					<Show
						when={!deviceTrace.loading}
						fallback={<p class="skeleton">Loading trace…</p>}
					>
						<Show
							when={(deviceTrace()?.paths ?? []).length > 0}
							fallback={
								<p class="empty">
									No cables beyond this device within the selected depth.
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
						<h4>Direct cables ({nodeEdges().length})</h4>
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
				<section class="card" aria-label="Cable trace">
					<h3>Cable trace</h3>
					<Show
						when={!cableTrace.loading}
						fallback={<p class="skeleton">Loading cable trace…</p>}
					>
						<Show when={cableTrace()} fallback={<p class="empty">Cable not found.</p>}>
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
								Paths from {cableTrace()?.a_device.name} (
								{cableTrace()?.paths_from_a.length ?? 0})
							</h4>
							<Show
								when={(cableTrace()?.paths_from_a ?? []).length > 0}
								fallback={<p class="empty">Dead end on this side.</p>}
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
								Paths from {cableTrace()?.b_device.name} (
								{cableTrace()?.paths_from_b.length ?? 0})
							</h4>
							<Show
								when={(cableTrace()?.paths_from_b ?? []).length > 0}
								fallback={<p class="empty">Dead end on this side.</p>}
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
				<h3>Cables ({edges().length})</h3>
				<table>
					<thead>
						<tr>
							<th>A endpoint</th>
							<th>B endpoint</th>
							<th>Label</th>
							<th>Status</th>
							<th>Trace</th>
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
											Trace
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
