import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import {
	type IntegrationProvider,
	ignore_external,
	ignore_local,
	import_external_employees,
	type LinkBoard,
	type LinkBoardExternal,
	type LinkBoardLocal,
	link_external,
	unlink_external,
} from '../../api/integrations'
import { t, tp } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { goTo } from '../../lib/router'
import { can } from '../../lib/session'

type Side = 'local' | 'external'

interface Picked {
	side: Side
	id: string
}

function matches(needle: string, ...values: (string | null)[]): boolean {
	return needle === '' || values.some((v) => (v ?? '').toLowerCase().includes(needle))
}

function tokens(name: string): Set<string> {
	return new Set(
		name
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((w) => w.length >= 2),
	)
}

/** Shared name words; ranks likely partners of the picked row first. */
function similarity(words: Set<string>, name: string): number {
	let score = 0
	for (const word of tokens(name)) {
		if (words.has(word)) {
			score += 1
		}
	}
	return score
}

function detailText(...values: (string | null)[]): string {
	return values.filter((v) => v !== null && v !== '').join(' · ')
}

/**
 * conex objects (left) and external objects (right) of one link level side
 * by side. Click a row on each side (either order) to link them; "Link all
 * suggestions" takes every unambiguous match at once. Picking a row ranks
 * likely partners first on the other side. Linked rows stay visible after unlinked ones; ignored rows
 * are hidden unless toggled on, so both lists shrink while working. Changes
 * show immediately and are reconciled with the server's board afterwards.
 * The employee board can also import every open external employee into
 * conex at once.
 */
export function LinkBoardView(props: {
	provider: IntegrationProvider
	board: LinkBoard
	/** conex tenant of a device/employee board. */
	tenant_id?: number
	editable: boolean
	on_error: (message: string | null) => void
	/** Reloads the board from the server. */
	on_changed: () => void
	/** Called with the conex ids linked by one user action. */
	on_linked?: (ids: number[]) => void
}): JSX.Element {
	const [showIgnored, setShowIgnored] = createSignal(false)
	const [localSearch, setLocalSearch] = createSignal('')
	const [externalSearch, setExternalSearch] = createSignal('')
	const [picked, setPicked] = createSignal<Picked | null>(null)
	const [busy, setBusy] = createSignal(false)
	// Optimistic changes, dropped whenever a fresh board arrives.
	const [linked, setLinked] = createSignal(new Map<number, string>())
	const [ignored, setIgnored] = createSignal(new Set<string>())
	const [ignoredLocal, setIgnoredLocal] = createSignal(new Set<number>())
	const [released, setReleased] = createSignal(new Set<string>())
	const [releasedLocal, setReleasedLocal] = createSignal(new Set<number>())

	createEffect(
		on(
			() => props.board,
			() => {
				setLinked(new Map<number, string>())
				setIgnored(new Set<string>())
				setIgnoredLocal(new Set<number>())
				setReleased(new Set<string>())
				setReleasedLocal(new Set<number>())
			},
			{ defer: true },
		),
	)

	const provider = (): string => providerLabel(props.provider)
	/** Device and employee boards can ignore conex rows as missing externally. */
	const ignoresLocal = (): boolean => props.board.entity_type !== 'tenant'
	const localPath = (id: number): string => {
		const base =
			props.board.entity_type === 'device'
				? 'devices'
				: props.board.entity_type === 'employee'
					? 'employees'
					: 'tenants'
		return `/${base}/${id}`
	}

	const localById = createMemo(() => new Map(props.board.local.map((r) => [r.id, r])))
	const externalById = createMemo(
		() => new Map(props.board.external.map((r) => [r.external_id, r])),
	)
	const pendingExternal = createMemo(() => new Set(linked().values()))

	/** External id a conex row is linked to, optimistic changes applied. */
	function localLink(row: LinkBoardLocal): string | null {
		const pending = linked().get(row.id)
		if (pending !== undefined) {
			return pending
		}
		if (row.external_id === null || released().has(row.external_id)) {
			return null
		}
		// Moved to another conex row in this session.
		return pendingExternal().has(row.external_id) ? null : row.external_id
	}
	function localIgnored(row: LinkBoardLocal): boolean {
		return (row.ignored && !releasedLocal().has(row.id)) || ignoredLocal().has(row.id)
	}
	function externalIgnored(row: LinkBoardExternal): boolean {
		return (
			ignored().has(row.external_id) ||
			(row.state === 'ignored' && !released().has(row.external_id))
		)
	}
	function localOpen(row: LinkBoardLocal): boolean {
		return localLink(row) === null && !localIgnored(row)
	}
	/** Linked rows stay visible; only ignored rows are hidden by the toggle. */
	function localVisible(row: LinkBoardLocal): boolean {
		return showIgnored() || !localIgnored(row)
	}
	function externalVisible(row: LinkBoardExternal): boolean {
		return showIgnored() || !externalIgnored(row)
	}
	/** Open rows first, linked rows after, ignored rows last. */
	function localOrder(row: LinkBoardLocal): number {
		if (localIgnored(row)) {
			return 2
		}
		return localLink(row) === null ? 0 : 1
	}
	function externalOrder(row: LinkBoardExternal): number {
		if (externalIgnored(row)) {
			return 2
		}
		return externalOpen(row) ? 0 : 1
	}
	/** Stable sort by status, then descending score (ties keep server order). */
	function rankBy<T>(rows: T[], order: (row: T) => number, score: (row: T) => number): T[] {
		return rows
			.map((row, index) => ({ row, index, order: order(row), score: score(row) }))
			.sort((a, b) => a.order - b.order || b.score - a.score || a.index - b.index)
			.map((entry) => entry.row)
	}
	function externalOpen(row: LinkBoardExternal): boolean {
		return (
			(row.state === null || released().has(row.external_id)) &&
			!pendingExternal().has(row.external_id) &&
			!ignored().has(row.external_id)
		)
	}

	const openLocal = createMemo(() => props.board.local.filter(localOpen))
	const openExternal = createMemo(() => props.board.external.filter(externalOpen))

	/** Unambiguous suggestions whose both sides are still free. */
	const suggestions = createMemo((): [number, string][] => {
		const free = new Set(openExternal().map((r) => r.external_id))
		const pairs: [number, string][] = []
		for (const row of openLocal()) {
			if (row.suggestion && free.has(row.suggestion.external_id)) {
				pairs.push([row.id, row.suggestion.external_id])
			}
		}
		const uses = new Map<string, number>()
		for (const [, externalId] of pairs) {
			uses.set(externalId, (uses.get(externalId) ?? 0) + 1)
		}
		return pairs.filter(([, externalId]) => uses.get(externalId) === 1)
	})
	const suggestionOf = createMemo(() => new Map(suggestions()))

	const pickedLocal = (): LinkBoardLocal | undefined => {
		const p = picked()
		return p?.side === 'local' ? localById().get(Number(p.id)) : undefined
	}
	const pickedExternal = (): LinkBoardExternal | undefined => {
		const p = picked()
		return p?.side === 'external' ? externalById().get(p.id) : undefined
	}

	const localRows = createMemo(() => {
		const needle = localSearch().trim().toLowerCase()
		const rows = props.board.local.filter(
			(r) => localVisible(r) && matches(needle, r.name, r.detail, r.serial),
		)
		const partner = pickedExternal()
		const words = partner ? tokens(partner.name) : null
		return rankBy(rows, localOrder, (r) =>
			words === null
				? 0
				: r.suggestion?.external_id === partner?.external_id
					? 100
					: similarity(words, r.name),
		)
	})
	const externalRows = createMemo(() => {
		const needle = externalSearch().trim().toLowerCase()
		const rows = props.board.external.filter(
			(r) => externalVisible(r) && matches(needle, r.name, r.detail, r.serial),
		)
		const partner = pickedLocal()
		const words = partner ? tokens(partner.name) : null
		return rankBy(rows, externalOrder, (r) =>
			words === null
				? 0
				: partner?.suggestion?.external_id === r.external_id
					? 100
					: similarity(words, r.name),
		)
	})

	// Actions -------------------------------------------------------------------
	async function linkPairs(pairs: [number, string][]): Promise<void> {
		if (pairs.length === 0) {
			return
		}
		props.on_error(null)
		setPicked(null)
		setLinked((prev) => {
			const next = new Map(prev)
			for (const [localId, externalId] of pairs) {
				next.set(localId, externalId)
			}
			return next
		})
		setBusy(true)
		const done: number[] = []
		for (const [localId, externalId] of pairs) {
			const res = await link_external(
				props.provider,
				props.board.entity_type,
				localId,
				externalId,
			)
			if (Result.isError(res)) {
				props.on_error(res.error.message)
				break
			}
			done.push(localId)
		}
		setBusy(false)
		if (done.length > 0) {
			props.on_linked?.(done)
		}
		props.on_changed()
	}

	async function ignore(externalId: string): Promise<void> {
		props.on_error(null)
		setPicked(null)
		setIgnored((prev) => new Set(prev).add(externalId))
		const res = await ignore_external(props.provider, props.board.entity_type, externalId)
		if (Result.isError(res)) {
			props.on_error(res.error.message)
		}
		props.on_changed()
	}

	async function ignoreLocal(localId: number): Promise<void> {
		const entityType = props.board.entity_type
		if (entityType === 'tenant') {
			return
		}
		props.on_error(null)
		setPicked(null)
		setIgnoredLocal((prev) => new Set(prev).add(localId))
		const res = await ignore_local(props.provider, entityType, localId)
		if (Result.isError(res)) {
			props.on_error(res.error.message)
		}
		props.on_changed()
	}

	/**
	 * Active external employees still open and not suggested for a conex
	 * row: what "Import" would create (suggestions are linked instead).
	 */
	const importable = createMemo(() => {
		if (props.board.entity_type !== 'employee') {
			return []
		}
		const suggested = new Set(suggestions().map(([, externalId]) => externalId))
		return openExternal().filter((r) => r.active && !suggested.has(r.external_id))
	})

	async function importAll(): Promise<void> {
		const tenantId = props.tenant_id
		const rows = importable()
		if (
			tenantId === undefined ||
			rows.length === 0 ||
			!window.confirm(tp('integration.confirmImportEmployees', rows.length))
		) {
			return
		}
		props.on_error(null)
		setPicked(null)
		setBusy(true)
		const res = await import_external_employees(
			props.provider,
			tenantId,
			rows.map((r) => r.external_id),
		)
		setBusy(false)
		if (Result.isError(res)) {
			props.on_error(res.error.message)
		}
		props.on_changed()
	}

	async function unlink(linkId: number, externalId: string): Promise<void> {
		props.on_error(null)
		setReleased((prev) => new Set(prev).add(externalId))
		const res = await unlink_external(props.provider, linkId)
		if (Result.isError(res)) {
			props.on_error(res.error.message)
		}
		props.on_changed()
	}

	async function restoreLocal(row: LinkBoardLocal): Promise<void> {
		if (row.link_id === null) {
			return
		}
		props.on_error(null)
		setReleasedLocal((prev) => new Set(prev).add(row.id))
		const res = await unlink_external(props.provider, row.link_id)
		if (Result.isError(res)) {
			props.on_error(res.error.message)
		}
		props.on_changed()
	}

	/** Row click: pick it, or link it to the row picked on the other side. */
	function pick(side: Side, id: string): void {
		if (!props.editable) {
			return
		}
		const current = picked()
		if (current && current.side !== side) {
			void linkPairs([side === 'local' ? [Number(id), current.id] : [Number(current.id), id]])
			return
		}
		setPicked(current?.id === id ? null : { side, id })
	}

	function rowKeyDown(e: KeyboardEvent, activate: () => void): void {
		if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault()
			activate()
		}
	}

	/** Click handler for buttons inside a clickable row. */
	function inRow(action: () => void): (e: MouseEvent) => void {
		return (e: MouseEvent): void => {
			e.stopPropagation()
			action()
		}
	}

	// Cells -----------------------------------------------------------------------
	function localState(row: LinkBoardLocal): JSX.Element {
		if (localIgnored(row)) {
			return (
				<>
					<span class="badge">{t('integration.ignored')}</span>
					<Show when={props.editable && row.link_id !== null}>
						<button
							type="button"
							class="btn-small"
							onClick={inRow(() => void restoreLocal(row))}
						>
							{t('integration.restore')}
						</button>
					</Show>
				</>
			)
		}
		const externalId = localLink(row)
		if (externalId !== null) {
			const name =
				externalById().get(externalId)?.name ??
				(externalId === row.external_id ? row.external_name : null)
			return (
				<>
					<span>→ {name ?? t('integration.staleExternal', { id: externalId })}</span>
					<Show
						when={
							props.editable && row.link_id !== null && externalId === row.external_id
						}
					>
						<button
							type="button"
							class="btn-small"
							onClick={inRow(() => void unlink(row.link_id ?? 0, externalId))}
						>
							{t('integration.unlink')}
						</button>
					</Show>
				</>
			)
		}
		const suggested = suggestionOf().get(row.id)
		if (suggested === undefined) {
			return (
				<Show when={props.editable && ignoresLocal()}>
					<button
						type="button"
						class="btn-small"
						onClick={inRow(() => void ignoreLocal(row.id))}
					>
						{t('integration.ignore')}
					</button>
				</Show>
			)
		}
		return (
			<>
				<span class="link-board-suggestion">
					≈ {externalById().get(suggested)?.name ?? suggested}
				</span>
				<Show when={props.editable}>
					<button
						type="button"
						class="btn-small"
						onClick={inRow(() => void linkPairs([[row.id, suggested]]))}
					>
						{t('integration.confirmLink')}
					</button>
				</Show>
				<Show when={props.editable && ignoresLocal()}>
					<button
						type="button"
						class="btn-small"
						onClick={inRow(() => void ignoreLocal(row.id))}
					>
						{t('integration.ignore')}
					</button>
				</Show>
			</>
		)
	}

	function externalState(row: LinkBoardExternal): JSX.Element {
		if (externalOpen(row)) {
			return (
				<Show when={props.editable}>
					<button
						type="button"
						class="btn-small"
						onClick={inRow(() => void ignore(row.external_id))}
					>
						{t('integration.ignore')}
					</button>
				</Show>
			)
		}
		if (externalIgnored(row)) {
			return (
				<>
					<span class="badge">{t('integration.ignored')}</span>
					<Show when={props.editable && row.state === 'ignored' && row.link_id !== null}>
						<button
							type="button"
							class="btn-small"
							onClick={inRow(() => void unlink(row.link_id ?? 0, row.external_id))}
						>
							{t('integration.restore')}
						</button>
					</Show>
				</>
			)
		}
		const pendingLocal = [...linked()].find(([, id]) => id === row.external_id)?.[0]
		const name =
			pendingLocal !== undefined ? localById().get(pendingLocal)?.name : row.entity_name
		return <span>← {name ?? (row.entity_id !== null ? `#${row.entity_id}` : '')}</span>
	}

	function searchBox(value: () => string, set: (v: string) => void): JSX.Element {
		return (
			<input
				type="search"
				class="toolbar-search-input"
				aria-label={t('common.search')}
				placeholder={t('common.search')}
				value={value()}
				onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
					set(e.currentTarget.value)
				}
			/>
		)
	}

	const empty = (): JSX.Element => (
		<tr>
			<td class="text-muted">{t('integration.noRows')}</td>
		</tr>
	)

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Escape drops the picked row.
		<div
			class="link-board"
			onKeyDown={(e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					setPicked(null)
				}
			}}
		>
			<section class="link-board-side">
				<h3>
					{t('integration.sideConex')}{' '}
					<small class="text-muted">
						{t('integration.openCount', { count: openLocal().length })}
					</small>
				</h3>
				{searchBox(localSearch, setLocalSearch)}
				<div class="link-board-scroll">
					<table>
						<tbody>
							<For each={localRows()} fallback={empty()}>
								{(row: LinkBoardLocal): JSX.Element => (
									<tr
										class="link-board-row"
										classList={{
											selected: pickedLocal()?.id === row.id,
											highlighted:
												pickedExternal() !== undefined &&
												row.suggestion?.external_id ===
													pickedExternal()?.external_id,
											inactive: !row.active,
										}}
										tabIndex={0}
										aria-selected={pickedLocal()?.id === row.id}
										onClick={() => pick('local', String(row.id))}
										onKeyDown={(e: KeyboardEvent) =>
											rowKeyDown(e, () => pick('local', String(row.id)))
										}
									>
										<td>
											<a
												href={localPath(row.id)}
												onClick={(e: MouseEvent): void => {
													e.stopPropagation()
													goTo(e, localPath(row.id))
												}}
											>
												{row.name}
											</a>
											<small class="link-board-detail">
												{detailText(row.detail, row.serial)}
											</small>
										</td>
										<td class="link-board-state">{localState(row)}</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
			</section>

			<section class="link-board-middle">
				<Show when={props.editable}>
					<Show when={suggestions().length > 0}>
						<button
							type="submit"
							disabled={busy()}
							onClick={() => void linkPairs(suggestions())}
						>
							{tp('integration.linkSuggestions', suggestions().length)}
						</button>
					</Show>
					<Show
						when={
							can('edit') && props.tenant_id !== undefined && importable().length > 0
						}
					>
						<button type="button" disabled={busy()} onClick={() => void importAll()}>
							{tp('integration.importEmployees', importable().length)}
						</button>
					</Show>
				</Show>
				<label class="link-board-toggle">
					<input
						type="checkbox"
						checked={showIgnored()}
						onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
							setShowIgnored(e.currentTarget.checked)
						}
					/>
					{t('integration.showIgnored')}
				</label>
			</section>

			<section class="link-board-side">
				<h3>
					{provider()}{' '}
					<small class="text-muted">
						{t('integration.openCount', { count: openExternal().length })}
					</small>
				</h3>
				{searchBox(externalSearch, setExternalSearch)}
				<div class="link-board-scroll">
					<table>
						<tbody>
							<For each={externalRows()} fallback={empty()}>
								{(row: LinkBoardExternal): JSX.Element => (
									<tr
										class="link-board-row"
										classList={{
											selected:
												pickedExternal()?.external_id === row.external_id,
											highlighted:
												pickedLocal()?.suggestion?.external_id ===
												row.external_id,
											inactive: !row.active,
										}}
										tabIndex={0}
										aria-selected={
											pickedExternal()?.external_id === row.external_id
										}
										onClick={() => pick('external', row.external_id)}
										onKeyDown={(e: KeyboardEvent) =>
											rowKeyDown(e, () => pick('external', row.external_id))
										}
									>
										<td>
											{row.name}
											<Show when={!row.active}>
												{' '}
												<span class="badge">
													{t('integration.inactive')}
												</span>
											</Show>
											<small class="link-board-detail">
												{detailText(row.detail, row.serial)}
											</small>
										</td>
										<td class="link-board-state">{externalState(row)}</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
			</section>
		</div>
	)
}
