/**
 * The editors' palette of unplaced racks, devices and outlets, shared by the
 * image floor plan editor and the drawn floor plan editor.
 */
import { createMemo, For, type JSX, Show } from 'solid-js'
import type { FloorplanCandidateJson } from '../api/attachments'
import { t } from '../i18n'
import { Loading } from './feedback'
import { MarkerGlyph } from './floorplan_stage'

/** Stable key of a rack, device, outlet port or jack, shared by candidates and markers. */
export function candidateKey(candidate: {
	rack_id: number | null
	device_id: number | null
	interface_id: number | null
	jack_id: number | null
}): string {
	if (candidate.rack_id !== null) {
		return `rack:${candidate.rack_id}`
	}
	if (candidate.jack_id !== null) {
		return `jack:${candidate.jack_id}`
	}
	return candidate.interface_id !== null
		? `port:${candidate.interface_id}`
		: `device:${candidate.device_id}`
}

interface PaletteGroup {
	/** Stable across placements, so the list keeps its DOM (and scroll position). */
	key: string
	name: string
	items: FloorplanCandidateJson[]
	/** Panel of an outlet group, for the sequence toggle; `null` for a location group. */
	panel_id: number | null
}

/**
 * Palette tab of the side panel: the unplaced racks and devices, grouped by
 * location, and the unplaced outlets, grouped by panel (in port order) with
 * a sequence toggle each, filtered by `search`.
 */
export function Palette(props: {
	search: string
	candidates: FloorplanCandidateJson[] | undefined
	loading: boolean
	placed: Set<string>
	/** Panel whose outlets the stage places in sequence, if any. */
	sequence: number | null
	on_sequence: (panelId: number | null) => void
	on_drag: (key: string | null) => void
	on_place: (candidate: FloorplanCandidateJson) => void
}): JSX.Element {
	const groups = createMemo(() => {
		const needle = props.search.trim().toLowerCase()
		const byGroup = new Map<string, PaletteGroup>()
		for (const candidate of props.candidates ?? []) {
			if (props.placed.has(candidateKey(candidate))) {
				continue
			}
			const port = candidate.port
			const name = port
				? t('floorplan.outletsOf', { name: port.device_name })
				: (candidate.location_name ?? t('floorplan.noLocation'))
			if (
				needle &&
				!candidate.name.toLowerCase().includes(needle) &&
				!name.toLowerCase().includes(needle)
			) {
				continue
			}
			const key = port ? `port:${port.device_id}` : `location:${name}`
			const group = byGroup.get(key) ?? {
				key,
				name,
				items: [],
				panel_id: port?.device_id ?? null,
			}
			group.items.push(candidate)
			byGroup.set(key, group)
		}
		// Outlets keep their port order (the server's); the rest sorts by name.
		return [...byGroup.values()]
			.map((group: PaletteGroup) => ({
				...group,
				items:
					group.panel_id === null
						? group.items.sort((a, b) => a.name.localeCompare(b.name))
						: group.items,
			}))
			.sort(
				(a, b) =>
					Number(a.panel_id !== null) - Number(b.panel_id !== null) ||
					a.name.localeCompare(b.name),
			)
	})
	const groupKeys = createMemo(() => groups().map((group: PaletteGroup) => group.key))
	const groupsByKey = createMemo(
		() => new Map(groups().map((group: PaletteGroup) => [group.key, group])),
	)

	return (
		<Show when={!props.loading} fallback={<Loading message={t('common.loading')} />}>
			<Show
				when={groups().length > 0}
				fallback={<p class="floorplan-hint">{t('floorplan.paletteEmpty')}</p>}
			>
				{/* Keyed by group key: rebuilding the sections on each placement resets the scroll. */}
				<For each={groupKeys()}>
					{(key: string) => {
						const group = (): PaletteGroup =>
							groupsByKey().get(key) ?? { key, name: '', items: [], panel_id: null }
						return (
							<section>
								<div class="floorplan-palette-group-header">
									<h5>{group().name}</h5>
									<Show when={group().panel_id}>
										{(panelId: () => number) => (
											<button
												type="button"
												class="floorplan-palette-sequence"
												classList={{ active: props.sequence === panelId() }}
												aria-pressed={props.sequence === panelId()}
												title={t('floorplan.sequenceHint')}
												onClick={() =>
													props.on_sequence(
														props.sequence === panelId()
															? null
															: panelId(),
													)
												}
											>
												{t('floorplan.sequence')}
											</button>
										)}
									</Show>
								</div>
								<ul>
									<For each={group().items}>
										{(candidate: FloorplanCandidateJson) => (
											<li>
												<button
													type="button"
													class="floorplan-palette-item"
													draggable="true"
													title={t('floorplan.placeHint')}
													onDragStart={(e: DragEvent) => {
														e.dataTransfer?.setData(
															'text/plain',
															candidateKey(candidate),
														)
														props.on_drag(candidateKey(candidate))
													}}
													onDragEnd={() => props.on_drag(null)}
													onClick={() => props.on_place(candidate)}
												>
													<MarkerGlyph placement={candidate} size={14} />
													<span>{candidate.name}</span>
												</button>
											</li>
										)}
									</For>
								</ul>
							</section>
						)
					}}
				</For>
			</Show>
		</Show>
	)
}
