import { IconBan, IconLinkPlus, IconUnlink, IconX } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from 'solid-js'
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
import { Empty } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { compareFieldLabel, providerLabel } from '../../i18n/labels'
import { useAction } from '../../lib/resource'
import { goTo } from '../../lib/router'
import { can } from '../../lib/session'
import { formatTime } from '../../lib/time'

type Side = 'local' | 'external'

/** Status switch of the board: what still needs work, what is done, what is set aside. */
type Filter = 'open' | 'linked' | 'ignored'

interface Picked {
	side: Side
	id: string
}

/** One suggested pair: conex row, external row and the field they matched on. */
interface SuggestedPair {
	local: LinkBoardLocal
	external: LinkBoardExternal
	via: string
}

/** One linked pair of the "Linked" view. */
interface LinkedPair {
	key: string
	local: () => JSX.Element
	external: () => JSX.Element
	/** Searchable text of both sides. */
	text: (string | null)[]
	/** Removes the link; null when it cannot be removed here (yet). */
	unlink: (() => void) | null
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
 * conex objects and external objects of one link level. A summary with the
 * linked share sits on top, then a status switch (Open / Linked / Ignored),
 * one search for both sides and the bulk actions ("Link all suggestions",
 * on the employee board "Import employees").
 *
 * - **Open:** unambiguous suggestions as pairs, each linked with one click or
 *   dismissed as "not a match" (for this visit; both rows then join the
 *   lists below). Below, the remaining rows side by side: click a row on each
 *   side (either order) to link them; picking a row ranks likely partners
 *   first on the other side.
 * - **Linked:** one row per link, with Unlink.
 * - **Ignored:** ignored rows of both sides, with Restore.
 *
 * Changes show immediately and are reconciled with the server's board
 * afterwards.
 */
export function LinkBoardView(props: {
	provider: IntegrationProvider
	board: LinkBoard
	/** conex tenant of a device/employee board. */
	tenant_id?: number
	editable: boolean
	on_error: (message: string | null) => void
	/** Called with the conex ids linked by one user action. */
	on_linked?: (ids: number[]) => void
}): JSX.Element {
	const [filter, setFilter] = createSignal<Filter>('open')
	const [search, setSearch] = createSignal('')
	const [picked, setPicked] = createSignal<Picked | null>(null)
	const [busy, setBusy] = createSignal(false)
	// Suggestions rejected as "not a match" (conex ids); kept across reloads.
	const [dismissed, setDismissed] = createSignal(new Set<number>())
	const write = useAction(props.on_error)
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
	const needle = (): string => search().trim().toLowerCase()
	const localPath = (id: number): string => `/${props.board.entity_type}s/${id}`

	/** The same level on the cross-integration matching page. */
	const matchingHref = (): string => {
		const type = props.board.entity_type
		if (type === 'tenant') {
			return '/integrations/matching'
		}
		if (type === 'site') {
			return '/integrations/matching?type=sites'
		}
		const tenant = props.tenant_id === undefined ? '' : `&tenant=${props.tenant_id}`
		return `/integrations/matching?type=${type === 'device' ? 'devices' : 'employees'}${tenant}`
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
	function externalOpen(row: LinkBoardExternal): boolean {
		return (
			(row.state === null || released().has(row.external_id)) &&
			!pendingExternal().has(row.external_id) &&
			!ignored().has(row.external_id)
		)
	}
	/** Stable sort by descending score (ties keep server order). */
	function rankBy<T>(rows: T[], score: (row: T) => number): T[] {
		return rows
			.map((row, index) => ({ row, index, score: score(row) }))
			.sort((a, b) => b.score - a.score || a.index - b.index)
			.map((entry) => entry.row)
	}

	const openLocal = createMemo(() => props.board.local.filter(localOpen))
	const openExternal = createMemo(() => props.board.external.filter(externalOpen))

	/** Unambiguous, not dismissed suggestions whose both sides are still free. */
	const suggestions = createMemo((): SuggestedPair[] => {
		const free = new Set(openExternal().map((r) => r.external_id))
		const pairs: SuggestedPair[] = []
		for (const local of openLocal()) {
			const suggestion = local.suggestion
			const external = suggestion ? externalById().get(suggestion.external_id) : undefined
			if (
				suggestion &&
				external &&
				free.has(suggestion.external_id) &&
				!dismissed().has(local.id)
			) {
				pairs.push({ local, external, via: suggestion.via })
			}
		}
		const uses = new Map<string, number>()
		for (const pair of pairs) {
			const id = pair.external.external_id
			uses.set(id, (uses.get(id) ?? 0) + 1)
		}
		return pairs.filter((pair) => uses.get(pair.external.external_id) === 1)
	})
	const suggestedLocal = createMemo(() => new Set(suggestions().map((p) => p.local.id)))
	const suggestedExternal = createMemo(
		() => new Set(suggestions().map((p) => p.external.external_id)),
	)
	const visibleSuggestions = createMemo(() =>
		suggestions().filter(
			(p) =>
				matches(needle(), p.local.name, p.local.detail, p.local.serial) ||
				matches(needle(), p.external.name, p.external.detail, p.external.serial),
		),
	)

	/** Open rows not covered by a suggestion: linked by picking both sides. */
	const unmatchedLocal = createMemo(() => openLocal().filter((r) => !suggestedLocal().has(r.id)))
	const unmatchedExternal = createMemo(() =>
		openExternal().filter((r) => !suggestedExternal().has(r.external_id)),
	)

	const pickedLocal = (): LinkBoardLocal | undefined => {
		const p = picked()
		return p?.side === 'local' ? localById().get(Number(p.id)) : undefined
	}
	const pickedExternal = (): LinkBoardExternal | undefined => {
		const p = picked()
		return p?.side === 'external' ? externalById().get(p.id) : undefined
	}

	const localRows = createMemo(() => {
		const rows = unmatchedLocal().filter((r) => matches(needle(), r.name, r.detail, r.serial))
		const partner = pickedExternal()
		if (!partner) {
			return rows
		}
		const words = tokens(partner.name)
		return rankBy(rows, (r) =>
			r.suggestion?.external_id === partner.external_id ? 100 : similarity(words, r.name),
		)
	})
	const externalRows = createMemo(() => {
		const rows = unmatchedExternal().filter((r) =>
			matches(needle(), r.name, r.detail, r.serial),
		)
		const partner = pickedLocal()
		if (!partner) {
			return rows
		}
		const words = tokens(partner.name)
		return rankBy(rows, (r) =>
			partner.suggestion?.external_id === r.external_id ? 100 : similarity(words, r.name),
		)
	})

	const ignoredLocalRows = createMemo(() =>
		props.board.local.filter(
			(r) => localIgnored(r) && matches(needle(), r.name, r.detail, r.serial),
		),
	)
	const ignoredExternalRows = createMemo(() =>
		props.board.external.filter(
			(r) => externalIgnored(r) && matches(needle(), r.name, r.detail, r.serial),
		),
	)
	const ignoredCount = createMemo(
		() =>
			props.board.local.filter(localIgnored).length +
			props.board.external.filter(externalIgnored).length,
	)

	/**
	 * Every link of the level: conex rows of the board first, then external
	 * rows linked to conex objects outside it (another tenant).
	 */
	const linkedPairs = createMemo((): LinkedPair[] => {
		const pairs: LinkedPair[] = []
		const shown = new Set<string>()
		for (const row of props.board.local) {
			const externalId = localLink(row)
			if (externalId === null || localIgnored(row)) {
				continue
			}
			shown.add(externalId)
			const external = externalById().get(externalId)
			const externalName =
				external?.name ?? (externalId === row.external_id ? row.external_name : null)
			const linkId = row.link_id
			pairs.push({
				key: `l${row.id}`,
				local: () => localCell(row),
				external: () =>
					external ? (
						externalCell(external)
					) : (
						<span class="text-muted">
							{externalName ?? t('integration.staleExternal', { id: externalId })}
						</span>
					),
				text: [row.name, row.detail, row.serial, externalName, external?.detail ?? null],
				unlink:
					props.editable && linkId !== null && externalId === row.external_id
						? () => void unlink(linkId, externalId)
						: null,
			})
		}
		for (const row of props.board.external) {
			if (
				shown.has(row.external_id) ||
				externalOpen(row) ||
				externalIgnored(row) ||
				(row.entity_id !== null && localById().has(row.entity_id))
			) {
				continue
			}
			const entityId = row.entity_id
			pairs.push({
				key: `e${row.external_id}`,
				local: () =>
					entityId !== null ? (
						<a href={localPath(entityId)}>{row.entity_name ?? `#${entityId}`}</a>
					) : (
						<span class="text-muted">—</span>
					),
				external: () => externalCell(row),
				text: [row.name, row.detail, row.serial, row.entity_name],
				unlink: null,
			})
		}
		return pairs
	})
	const visibleLinked = createMemo(() =>
		linkedPairs().filter((p) => matches(needle(), ...p.text)),
	)

	/** Linked share of the conex rows that are not ignored. */
	const progress = createMemo(() => {
		const rows = props.board.local.filter((r) => !localIgnored(r))
		const done = rows.filter((r) => localLink(r) !== null).length
		return { done, total: rows.length }
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
	}

	function linkSuggestions(pairs: SuggestedPair[]): Promise<void> {
		return linkPairs(pairs.map((p) => [p.local.id, p.external.external_id]))
	}

	function dismiss(localId: number): void {
		setDismissed((prev) => new Set(prev).add(localId))
	}

	async function ignore(externalId: string): Promise<void> {
		setPicked(null)
		setIgnored((prev) => new Set(prev).add(externalId))
		await write.run(() => ignore_external(props.provider, props.board.entity_type, externalId))
	}

	async function ignoreLocal(localId: number): Promise<void> {
		setPicked(null)
		setIgnoredLocal((prev) => new Set(prev).add(localId))
		await write.run(() => ignore_local(props.provider, props.board.entity_type, localId))
	}

	/**
	 * Active external employees still open and not suggested for a conex
	 * row: what "Import" would create (suggestions are linked instead).
	 */
	const importable = createMemo(() => {
		if (props.board.entity_type !== 'employee') {
			return []
		}
		return unmatchedExternal().filter((r) => r.active)
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
		setPicked(null)
		setBusy(true)
		await write.run(() =>
			import_external_employees(
				props.provider,
				tenantId,
				rows.map((r) => r.external_id),
			),
		)
		setBusy(false)
	}

	async function unlink(linkId: number, externalId: string): Promise<void> {
		setReleased((prev) => new Set(prev).add(externalId))
		await write.run(() => unlink_external(props.provider, linkId))
	}

	async function restoreLocal(row: LinkBoardLocal): Promise<void> {
		if (row.link_id === null) {
			return
		}
		setReleasedLocal((prev) => new Set(prev).add(row.id))
		const linkId = row.link_id
		await write.run(() => unlink_external(props.provider, linkId))
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

	function selectFilter(next: Filter): void {
		setPicked(null)
		setFilter(next)
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
	function inactiveBadge(active: boolean): JSX.Element {
		return (
			<Show when={!active}>
				{' '}
				<span class="badge">{t('integration.inactive')}</span>
			</Show>
		)
	}

	function localCell(row: LinkBoardLocal): JSX.Element {
		return (
			<>
				<a
					href={localPath(row.id)}
					onClick={(e: MouseEvent): void => {
						e.stopPropagation()
						goTo(e, localPath(row.id))
					}}
				>
					{row.name}
				</a>
				{inactiveBadge(row.active)}
				<small class="link-board-detail">{detailText(row.detail, row.serial)}</small>
			</>
		)
	}

	function externalCell(row: LinkBoardExternal): JSX.Element {
		return (
			<>
				<span class="link-board-name">{row.name}</span>
				{inactiveBadge(row.active)}
				<small class="link-board-detail">{detailText(row.detail, row.serial)}</small>
			</>
		)
	}

	function ignoreButton(action: () => void): JSX.Element {
		return (
			<button
				type="button"
				class="icon-btn"
				title={t('integration.ignore')}
				aria-label={t('integration.ignore')}
				onClick={inRow(action)}
			>
				<IconBan size={18} />
			</button>
		)
	}

	function restoreButton(action: () => void): JSX.Element {
		return (
			<button type="button" class="btn-small" onClick={action}>
				{t('integration.restore')}
			</button>
		)
	}

	function emptyRow(colspan: number): JSX.Element {
		return (
			<tr>
				<td class="text-muted" colspan={colspan}>
					{t('integration.noRows')}
				</td>
			</tr>
		)
	}

	/** Column title with its row count ("12 open", "3 ignored"). */
	function columnHeading(label: string, count: string): JSX.Element {
		return (
			<h4 class="link-board-heading">
				{label} <span class="text-muted">{count}</span>
			</h4>
		)
	}

	// Views -----------------------------------------------------------------------
	function filterOption(value: Filter, label: string, count: number): JSX.Element {
		return (
			<button
				type="button"
				class="link-board-filter-option"
				aria-pressed={filter() === value}
				onClick={(): void => selectFilter(value)}
			>
				{label} <span class="badge">{count}</span>
			</button>
		)
	}

	function pairsTable(children: JSX.Element): JSX.Element {
		return (
			<div class="link-board-scroll">
				<table class="link-board-pairs">
					<thead>
						<tr>
							<th>{t('integration.sideConex')}</th>
							<th class="link-board-arrow" />
							<th>{provider()}</th>
							<th class="link-board-actions">
								<span class="visually-hidden">{t('table.actions')}</span>
							</th>
						</tr>
					</thead>
					<tbody>{children}</tbody>
				</table>
			</div>
		)
	}

	const pickedName = (): string => pickedLocal()?.name ?? pickedExternal()?.name ?? ''

	const openView = (): JSX.Element => (
		<Show
			when={suggestions().length + unmatchedLocal().length + unmatchedExternal().length > 0}
			fallback={<Empty message={t('integration.nothingOpen')} />}
		>
			<Show when={suggestions().length > 0}>
				<section class="link-board-section">
					<h3>
						{t('integration.suggestions')}{' '}
						<span class="badge">{suggestions().length}</span>
					</h3>
					<p class="link-board-hint">{t('integration.suggestionsHint')}</p>
					{pairsTable(
						<For each={visibleSuggestions()} fallback={emptyRow(4)}>
							{(pair: SuggestedPair): JSX.Element => (
								<tr>
									<td>{localCell(pair.local)}</td>
									<td class="link-board-arrow">
										<span class="link-board-via">
											{t('integration.matchVia', {
												field: compareFieldLabel(pair.via),
											})}
										</span>
									</td>
									<td>{externalCell(pair.external)}</td>
									<td class="link-board-actions">
										<span class="row-actions">
											<Show when={props.editable}>
												<button
													type="button"
													class="icon-btn icon-btn-connect"
													disabled={busy()}
													title={t('integration.confirmLink')}
													aria-label={t('integration.confirmLink')}
													onClick={(): void =>
														void linkSuggestions([pair])
													}
												>
													<IconLinkPlus size={18} />
												</button>
												<button
													type="button"
													class="icon-btn"
													title={t('integration.dismissSuggestion')}
													aria-label={t('integration.dismissSuggestion')}
													onClick={(): void => dismiss(pair.local.id)}
												>
													<IconX size={18} />
												</button>
											</Show>
										</span>
									</td>
								</tr>
							)}
						</For>,
					)}
				</section>
			</Show>

			<Show when={unmatchedLocal().length + unmatchedExternal().length > 0}>
				<section class="link-board-section">
					<h3>{t('integration.unmatched')}</h3>
					<Show when={props.editable}>
						<Show
							when={picked()}
							fallback={<p class="link-board-hint">{t('integration.pickHint')}</p>}
						>
							<div class="link-board-pickbar" role="status">
								<span>
									{t('integration.pickedHint', {
										name: pickedName(),
										side:
											picked()?.side === 'local'
												? provider()
												: t('integration.sideConex'),
									})}
								</span>
								<button
									type="button"
									class="btn-small"
									onClick={(): void => {
										setPicked(null)
									}}
								>
									{t('common.cancel')}
								</button>
							</div>
						</Show>
					</Show>
					<div class="link-board-columns">
						<div class="link-board-column">
							{columnHeading(
								t('integration.sideConex'),
								t('integration.openCount', { count: unmatchedLocal().length }),
							)}
							<div class="link-board-scroll">
								<table class="link-board-list">
									<tbody>
										<For each={localRows()} fallback={emptyRow(2)}>
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
														pickable: props.editable,
													}}
													tabIndex={props.editable ? 0 : undefined}
													aria-selected={pickedLocal()?.id === row.id}
													onClick={(): void =>
														pick('local', String(row.id))
													}
													onKeyDown={(e: KeyboardEvent): void =>
														rowKeyDown(e, (): void =>
															pick('local', String(row.id)),
														)
													}
												>
													<td>{localCell(row)}</td>
													<td class="link-board-actions">
														<span class="row-actions">
															<Show when={props.editable}>
																{ignoreButton(
																	() => void ignoreLocal(row.id),
																)}
															</Show>
														</span>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</div>
						<div class="link-board-column">
							{columnHeading(
								provider(),
								t('integration.openCount', { count: unmatchedExternal().length }),
							)}
							<div class="link-board-scroll">
								<table class="link-board-list">
									<tbody>
										<For each={externalRows()} fallback={emptyRow(2)}>
											{(row: LinkBoardExternal): JSX.Element => (
												<tr
													class="link-board-row"
													classList={{
														selected:
															pickedExternal()?.external_id ===
															row.external_id,
														highlighted:
															pickedLocal()?.suggestion
																?.external_id === row.external_id,
														inactive: !row.active,
														pickable: props.editable,
													}}
													tabIndex={props.editable ? 0 : undefined}
													aria-selected={
														pickedExternal()?.external_id ===
														row.external_id
													}
													onClick={(): void =>
														pick('external', row.external_id)
													}
													onKeyDown={(e: KeyboardEvent): void =>
														rowKeyDown(e, (): void =>
															pick('external', row.external_id),
														)
													}
												>
													<td>{externalCell(row)}</td>
													<td class="link-board-actions">
														<span class="row-actions">
															<Show when={props.editable}>
																{ignoreButton(
																	() =>
																		void ignore(
																			row.external_id,
																		),
																)}
															</Show>
														</span>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</div>
					</div>
				</section>
			</Show>
		</Show>
	)

	const linkedView = (): JSX.Element => (
		<Show
			when={linkedPairs().length > 0}
			fallback={<Empty message={t('integration.noLinked')} />}
		>
			{pairsTable(
				<For each={visibleLinked()} fallback={emptyRow(4)}>
					{(pair: LinkedPair): JSX.Element => (
						<tr>
							<td>{pair.local()}</td>
							<td class="link-board-arrow" aria-hidden="true">
								⇄
							</td>
							<td>{pair.external()}</td>
							<td class="link-board-actions">
								<span class="row-actions">
									<Show when={pair.unlink}>
										{(action: () => () => void): JSX.Element => (
											<button
												type="button"
												class="icon-btn icon-btn-danger"
												title={t('integration.unlink')}
												aria-label={t('integration.unlink')}
												onClick={(): void => action()()}
											>
												<IconUnlink size={18} />
											</button>
										)}
									</Show>
								</span>
							</td>
						</tr>
					)}
				</For>,
			)}
		</Show>
	)

	const ignoredView = (): JSX.Element => (
		<Show when={ignoredCount() > 0} fallback={<Empty message={t('integration.noIgnored')} />}>
			<div class="link-board-columns">
				<div class="link-board-column">
					{columnHeading(
						t('integration.sideConex'),
						t('integration.ignoredCount', { count: ignoredLocalRows().length }),
					)}
					<div class="link-board-scroll">
						<table class="link-board-list">
							<tbody>
								<For each={ignoredLocalRows()} fallback={emptyRow(2)}>
									{(row: LinkBoardLocal): JSX.Element => (
										<tr
											class="link-board-row"
											classList={{ inactive: !row.active }}
										>
											<td>{localCell(row)}</td>
											<td class="link-board-actions">
												<span class="row-actions">
													<Show
														when={
															props.editable && row.link_id !== null
														}
													>
														{restoreButton(
															() => void restoreLocal(row),
														)}
													</Show>
												</span>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</div>
				</div>
				<div class="link-board-column">
					{columnHeading(
						provider(),
						t('integration.ignoredCount', { count: ignoredExternalRows().length }),
					)}
					<div class="link-board-scroll">
						<table class="link-board-list">
							<tbody>
								<For each={ignoredExternalRows()} fallback={emptyRow(2)}>
									{(row: LinkBoardExternal): JSX.Element => (
										<tr
											class="link-board-row"
											classList={{ inactive: !row.active }}
										>
											<td>{externalCell(row)}</td>
											<td class="link-board-actions">
												<span class="row-actions">
													<Show
														when={
															props.editable &&
															row.state === 'ignored' &&
															row.link_id !== null
														}
													>
														{restoreButton(
															() =>
																void unlink(
																	row.link_id ?? 0,
																	row.external_id,
																),
														)}
													</Show>
												</span>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</Show>
	)

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Escape drops the picked row.
		<div
			class="link-board"
			onKeyDown={(e: KeyboardEvent): void => {
				if (e.key === 'Escape') {
					setPicked(null)
				}
			}}
		>
			<div class="link-board-summary">
				<div class="link-board-progress" aria-hidden="true">
					<div
						class="link-board-progress-bar"
						style={{
							width: `${progress().total === 0 ? 0 : (100 * progress().done) / progress().total}%`,
						}}
					/>
				</div>
				<span>
					{t('integration.boardProgress', {
						done: progress().done,
						total: progress().total,
					})}
				</span>
				<span class="text-muted">
					{props.board.synced_at
						? t('integration.syncedAt', { time: formatTime(props.board.synced_at) })
						: t('integration.neverSynced')}
				</span>
				<a class="link-board-matching" href={matchingHref()}>
					{t('matching.openFromBoard')}
				</a>
			</div>

			<div class="toolbar-row link-board-toolbar">
				<fieldset class="link-board-filter" aria-label={t('integration.boardFilter')}>
					{filterOption(
						'open',
						t('integration.boardOpen'),
						suggestions().length + unmatchedLocal().length + unmatchedExternal().length,
					)}
					{filterOption('linked', t('integration.boardLinked'), linkedPairs().length)}
					{filterOption('ignored', t('integration.ignored'), ignoredCount())}
				</fieldset>
				<input
					type="search"
					class="toolbar-search-input link-board-search"
					aria-label={t('integration.boardSearch')}
					placeholder={t('integration.boardSearch')}
					value={search()}
					onInput={(e: InputEvent & { currentTarget: HTMLInputElement }): void => {
						setSearch(e.currentTarget.value)
					}}
				/>
				<Show when={props.editable}>
					<Show when={suggestions().length > 0}>
						<button
							type="submit"
							disabled={busy()}
							onClick={(): void => void linkSuggestions(suggestions())}
						>
							<IconLabel icon={IconLinkPlus}>
								{tp('integration.linkSuggestions', suggestions().length)}
							</IconLabel>
						</button>
					</Show>
					<Show
						when={
							can('edit') && props.tenant_id !== undefined && importable().length > 0
						}
					>
						<button
							type="button"
							disabled={busy()}
							onClick={(): void => void importAll()}
						>
							{tp('integration.importEmployees', importable().length)}
						</button>
					</Show>
				</Show>
			</div>

			<Switch>
				<Match when={filter() === 'open'}>{openView()}</Match>
				<Match when={filter() === 'linked'}>{linkedView()}</Match>
				<Match when={filter() === 'ignored'}>{ignoredView()}</Match>
			</Switch>
		</div>
	)
}
