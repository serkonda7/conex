import { Combobox, type ComboboxOption } from '@serkonda7/solid-components'
import {
	IconAlertCircle,
	IconArrowsJoin2,
	IconBan,
	IconCircleCheck,
	IconCircleDashed,
	IconDeviceFloppy,
	IconSparkles,
	IconX,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js'
import {
	fetch_integrations,
	fetch_link_board,
	type IntegrationJson,
	type IntegrationProvider,
	ignore_local,
	type LinkBoard,
	type LinkBoardExternal,
	type LinkBoardLocal,
	type LinkEntityType,
	link_external,
	start_sync,
	unlink_external,
} from '../../api/integrations'
import { fetch_tenants } from '../../api/tenancy'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { t, tp } from '../../i18n'
import { compareFieldLabel, providerLabel } from '../../i18n/labels'
import { createRecord, createRows } from '../../lib/resource'
import { parseId, queryParam, usePageMeta } from '../../lib/router'
import { can, canGlobal, isScoped, sessionTenantId } from '../../lib/session'
import { contextTenantId } from '../../lib/tenant_context'

type Kind = LinkEntityType

/** Tenants and sites: linked to external tenants, listed in full for global users. */
function isTopLevel(kind: Kind): boolean {
	return kind === 'tenant' || kind === 'site'
}

/** Status filter of the rows. */
type Filter = 'all' | 'open' | 'done'

/** Combobox value of "missing in the external system" (devices, employees). */
const IGNORE = '__ignore'

/** One integration's board, with lookups the cells need. */
interface Column {
	provider: IntegrationProvider
	integration: IntegrationJson
	board: LinkBoard
	/** False while the tenant of a device/employee board is not linked there. */
	usable: boolean
	local: Map<number, LinkBoardLocal>
	external: Map<string, LinkBoardExternal>
	options: ComboboxOption[]
}

/** One conex object with its row on every board. */
interface MatchRow {
	id: number
	name: string
	detail: string | null
	serial: string | null
	active: boolean
}

interface Change {
	column: Column
	local: LinkBoardLocal
	from: string
	to: string
}

type CellState = 'linked' | 'ignored' | 'open'

function parseKind(raw: string): Kind {
	return raw === 'devices'
		? 'device'
		: raw === 'employees'
			? 'employee'
			: raw === 'sites'
				? 'site'
				: 'tenant'
}

function kindNoun(kind: Kind, count: number): string {
	switch (kind) {
		case 'tenant':
			return tp('entity.tenant', count)
		case 'site':
			return tp('entity.site', count)
		case 'device':
			return tp('entity.device', count)
		case 'employee':
			return tp('entity.employee', count)
	}
}

function cellKey(provider: IntegrationProvider, id: number): string {
	return `${provider}:${id}`
}

/** Value of a cell as stored on the server. */
function serverValue(local: LinkBoardLocal | undefined): string {
	if (local === undefined) {
		return ''
	}
	return local.ignored ? IGNORE : (local.external_id ?? '')
}

function stateOf(value: string): CellState {
	return value === IGNORE ? 'ignored' : value === '' ? 'open' : 'linked'
}

function matchesSearch(needle: string, ...values: (string | null | undefined)[]): boolean {
	return needle === '' || values.some((v) => (v ?? '').toLowerCase().includes(needle))
}

/** Boards of one level from every given integration, in the given order. */
async function fetchBoards(source: {
	providers: IntegrationProvider[]
	kind: Kind
	tenant: number | null
}): Promise<Result<LinkBoard[], Error>> {
	const results = await Promise.all(
		source.providers.map((p) => fetch_link_board(p, source.kind, source.tenant ?? undefined)),
	)
	const boards: LinkBoard[] = []
	for (const res of results) {
		if (Result.isError(res)) {
			return Result.err(res.error)
		}
		boards.push(res.value)
	}
	return Result.ok(boards)
}

function externalOptions(board: LinkBoard): ComboboxOption[] {
	// Built-in first entry: the object does not exist in this system.
	const options: ComboboxOption[] = [
		{ value: IGNORE, label: t('matching.ignore'), icon: IconBan },
	]
	for (const row of board.external) {
		if (row.state === 'ignored') {
			continue
		}
		const detail = [row.detail, row.serial, row.active ? null : t('integration.inactive')]
			.filter((part) => part !== null && part !== '')
			.join(' · ')
		options.push({
			value: row.external_id,
			label: row.name,
			detail: detail === '' ? undefined : detail,
		})
	}
	// Links to objects gone from the external system stay readable.
	const known = new Set(board.external.map((r) => r.external_id))
	for (const local of board.local) {
		if (local.external_id !== null && !local.ignored && !known.has(local.external_id)) {
			options.push({
				value: local.external_id,
				label:
					local.external_name ??
					t('integration.staleExternal', { id: local.external_id }),
			})
		}
	}
	return options
}

/** Viewport gap kept below or above a dropdown, in pixels. */
const LIST_MARGIN = 8
/** Tallest dropdown list (16rem), in pixels. */
const LIST_MAX = 256

/**
 * Pins the open dropdown of `box` to the viewport (see `.matching-scroll
 * .combobox-list`), so it overflows the scrolling table instead of being
 * clipped: below the field, or above it when there is more room there.
 */
function placeList(box: HTMLElement): void {
	const r = box.getBoundingClientRect()
	const below = window.innerHeight - r.bottom - LIST_MARGIN
	const above = r.top - LIST_MARGIN
	const up = below < LIST_MAX && above > below
	box.style.setProperty('--list-left', `${r.left}px`)
	box.style.setProperty('--list-width', `${r.width}px`)
	box.style.setProperty('--list-top', up ? 'auto' : `${r.bottom + 3}px`)
	box.style.setProperty('--list-bottom', up ? `${window.innerHeight - r.top + 3}px` : 'auto')
	box.style.setProperty('--list-max', `${Math.min(LIST_MAX, up ? above : below)}px`)
}

/** Repositions the dropdown of the focused combobox, if any. */
function placeFocusedList(): void {
	const box = document.activeElement?.closest<HTMLElement>('.matching-scroll .combobox')
	if (box) {
		placeList(box)
	}
}

/**
 * /integrations/matching — every conex object of one level (tenants, sites
 * for integrations that link sites (UniFi), or the devices or employees of
 * one tenant) as a row, with one column per enabled integration. Each cell picks the object's counterpart in that system
 * (searchable; picking one linked to another row moves it there), shows an
 * unambiguous suggestion to accept with one click, or marks the object as
 * missing there (the built-in "ignore" entry atop every dropdown).
 *
 * Edits are drafts until "Save matches"; the sticky footer counts the fully
 * matched rows and the unsaved changes. External objects without a conex
 * counterpart are counted per column and handled on the integration's own
 * link board (ignore, import employees).
 */
export function MatchingPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [kind, setKind] = createSignal<Kind>(
		isScoped() && isTopLevel(parseKind(queryParam('type')))
			? 'device'
			: parseKind(queryParam('type')),
	)
	const [tenant, setTenant] = createSignal<number | null>(
		parseId(queryParam('tenant')) ?? sessionTenantId() ?? contextTenantId(),
	)
	const [filter, setFilter] = createSignal<Filter>('all')
	const [search, setSearch] = createSignal('')
	const [drafts, setDrafts] = createSignal(new Map<string, string>())
	// Suggestions rejected as "not a match" in this visit (cell keys).
	const [dismissed, setDismissed] = createSignal(new Set<string>())
	const [saving, setSaving] = createSignal(false)
	// Drafts written by "Save" whose boards have not reloaded yet (key → value).
	const [saved, setSaved] = createSignal(new Map<string, string>())

	usePageMeta(() => ({ name: t('matching.title') }))

	const [integrations] = createRows(fetch_integrations, setError)
	const [tenants] = createRows(fetch_tenants, setError)

	const enabled = createMemo(() =>
		(integrations() ?? []).filter(
			(i) =>
				i.enabled &&
				(kind() === 'employee'
					? i.capabilities.employees
					: kind() === 'device' || i.capabilities.link_level === kind()),
		),
	)
	// Sites are a level of their own only while an integration links them.
	const hasSiteLevel = createMemo(() =>
		(integrations() ?? []).some((i) => i.enabled && i.capabilities.link_level === 'site'),
	)

	const source = createMemo(() => {
		const providers = enabled().map((i) => i.provider)
		if (providers.length === 0 || (!isTopLevel(kind()) && tenant() === null)) {
			return null
		}
		return { providers, kind: kind(), tenant: isTopLevel(kind()) ? null : tenant() }
	})
	const [boards] = createRecord(source, fetchBoards, setError)

	const editable = (): boolean =>
		isTopLevel(kind()) ? canGlobal('integrations.manage') : can('integrations.manage')

	const columns = createMemo((): Column[] => {
		const loaded = boards() ?? []
		return loaded.flatMap((board) => {
			const integration = enabled().find((i) => i.provider === board.provider)
			if (!integration) {
				return []
			}
			return [
				{
					provider: board.provider,
					integration,
					board,
					usable: isTopLevel(board.entity_type) || board.external_tenants.length > 0,
					local: new Map(board.local.map((r) => [r.id, r])),
					external: new Map(board.external.map((r) => [r.external_id, r])),
					options: externalOptions(board),
				},
			]
		})
	})
	const usableColumns = createMemo(() => columns().filter((c) => c.usable))

	// Fresh boards: drop drafts (and saved marks) the server now agrees with.
	createEffect(
		on(
			boards,
			() => {
				const byProvider = new Map(columns().map((c) => [c.provider, c]))
				const prune = (prev: Map<string, string>): Map<string, string> => {
					const out = new Map<string, string>()
					for (const [key, v] of prev) {
						const [provider, id] = key.split(':')
						const column = byProvider.get(provider as IntegrationProvider)
						const local = column?.local.get(Number(id))
						if (local && serverValue(local) !== v) {
							out.set(key, v)
						}
					}
					return out
				}
				setDrafts(prune)
				setSaved(prune)
			},
			{ defer: true },
		),
	)

	/** Union of the conex rows of all boards, by name. */
	const rows = createMemo((): MatchRow[] => {
		const byId = new Map<number, MatchRow>()
		for (const column of columns()) {
			for (const local of column.board.local) {
				if (!byId.has(local.id)) {
					byId.set(local.id, {
						id: local.id,
						name: local.name,
						detail: local.detail,
						serial: local.serial,
						active: local.active,
					})
				}
			}
		}
		return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
	})

	function value(column: Column, rowId: number): string {
		return drafts().get(cellKey(column.provider, rowId)) ?? serverValue(column.local.get(rowId))
	}

	/** External ids taken per provider, drafts applied. */
	const taken = createMemo(() => {
		const out = new Map<IntegrationProvider, Map<string, number>>()
		for (const column of usableColumns()) {
			const used = new Map<string, number>()
			for (const row of rows()) {
				const v = value(column, row.id)
				if (v !== '' && v !== IGNORE) {
					used.set(v, row.id)
				}
			}
			out.set(column.provider, used)
		}
		return out
	})

	/** Unambiguous suggestion of an open cell whose partner is still free. */
	function suggestion(
		column: Column,
		rowId: number,
	): { external: LinkBoardExternal; via: string } | null {
		const local = column.local.get(rowId)
		const s = local?.suggestion
		if (
			!s ||
			value(column, rowId) !== '' ||
			dismissed().has(cellKey(column.provider, rowId)) ||
			taken().get(column.provider)?.has(s.external_id) === true
		) {
			return null
		}
		const external = column.external.get(s.external_id)
		return external ? { external, via: s.via } : null
	}

	function setCell(column: Column, rowId: number, next: string): void {
		setDrafts((prev) => {
			const out = new Map(prev)
			const put = (id: number, v: string): void => {
				const key = cellKey(column.provider, id)
				if (v === serverValue(column.local.get(id))) {
					out.delete(key)
				} else {
					out.set(key, v)
				}
			}
			// One-to-one per integration: taking an object frees its previous row.
			if (next !== '' && next !== IGNORE) {
				const holder = taken().get(column.provider)?.get(next)
				if (holder !== undefined && holder !== rowId) {
					put(holder, '')
				}
			}
			put(rowId, next)
			return out
		})
	}

	function acceptSuggestions(targets: Column[]): void {
		for (const column of targets) {
			for (const row of visibleRows()) {
				const s = suggestion(column, row.id)
				if (s) {
					setCell(column, row.id, s.external.external_id)
				}
			}
		}
	}

	function rowStates(rowId: number): CellState[] {
		return usableColumns()
			.filter((c) => c.local.has(rowId))
			.map((c) => stateOf(value(c, rowId)))
	}
	function rowDone(rowId: number): boolean {
		return rowStates(rowId).every((s) => s !== 'open')
	}

	const needle = (): string => search().trim().toLowerCase()
	const searchedRows = createMemo(() =>
		rows().filter((row) =>
			matchesSearch(
				needle(),
				row.name,
				row.detail,
				row.serial,
				...usableColumns().map((c) => c.external.get(value(c, row.id))?.name),
			),
		),
	)
	const visibleRows = createMemo(() =>
		searchedRows().filter((row) =>
			filter() === 'all' ? true : (filter() === 'done') === rowDone(row.id),
		),
	)
	const doneCount = createMemo(() => rows().filter((row) => rowDone(row.id)).length)

	// Declared after `visibleRows`: memos evaluate at once, and with cached
	// boards (a revisit) the columns are already there.
	function suggestionCount(column: Column): number {
		return visibleRows().filter((row) => suggestion(column, row.id) !== null).length
	}
	const totalSuggestions = createMemo(() =>
		usableColumns().reduce((sum, c) => sum + suggestionCount(c), 0),
	)

	function columnProgress(column: Column): { done: number; total: number } {
		const ids = rows().filter((row) => column.local.has(row.id))
		return {
			done: ids.filter((row) => stateOf(value(column, row.id)) !== 'open').length,
			total: ids.length,
		}
	}

	/** Open external objects no row has taken: left for the integration's own board. */
	function leftover(column: Column): number {
		const used = taken().get(column.provider)
		return column.board.external.filter(
			(e) =>
				e.active &&
				e.state !== 'ignored' &&
				used?.has(e.external_id) !== true &&
				// Linked to a conex object outside this board (another tenant).
				!(e.state === 'linked' && e.entity_id !== null && !column.local.has(e.entity_id)),
		).length
	}

	function boardHref(column: Column): string {
		const view = isTopLevel(kind()) ? 'tenants' : `${kind()}s`
		const tenantQuery = isTopLevel(kind()) ? '' : `&tenant=${tenant() ?? ''}`
		return `/integrations/${column.integration.id}?view=${view}${tenantQuery}`
	}

	const changes = createMemo((): Change[] => {
		const out: Change[] = []
		for (const column of usableColumns()) {
			for (const row of rows()) {
				const local = column.local.get(row.id)
				const key = cellKey(column.provider, row.id)
				const to = drafts().get(key)
				if (local && to !== undefined && saved().get(key) !== to) {
					out.push({ column, local, from: serverValue(local), to })
				}
			}
		}
		return out
	})

	function confirmDiscard(): boolean {
		const count = changes().length
		return count === 0 || window.confirm(tp('matching.confirmDiscard', count))
	}

	function discard(): void {
		setDrafts((prev) => new Map([...prev].filter(([key, v]) => saved().get(key) === v)))
		setDismissed(new Set<string>())
	}

	function switchKind(next: Kind): void {
		if (next === kind() || !confirmDiscard()) {
			return
		}
		discard()
		setKind(next)
	}

	function switchTenant(next: string): void {
		if (!confirmDiscard()) {
			return
		}
		discard()
		setTenant(parseId(next))
	}

	/**
	 * Removals first, so an object moved between rows is free before it is
	 * linked again; stops at the first failure and keeps the rest as drafts.
	 * Newly linked tenants and sites get their devices fetched right away.
	 */
	async function save(): Promise<void> {
		const pending = changes()
		if (pending.length === 0 || saving()) {
			return
		}
		setError(null)
		setSaving(true)
		const ordered = [
			...pending.filter((c) => c.to === ''),
			...pending.filter((c) => c.to !== ''),
		]
		const done: Change[] = []
		for (const change of ordered) {
			const { provider } = change.column
			const linkId = change.local.link_id
			let res: Result<unknown, Error>
			if (change.to === '') {
				if (linkId === null) {
					done.push(change)
					continue
				}
				res = await unlink_external(provider, linkId)
			} else if (change.to === IGNORE) {
				res = await ignore_local(provider, kind(), change.local.id)
			} else {
				res = await link_external(provider, kind(), change.local.id, change.to)
			}
			if (Result.isError(res)) {
				setError(res.error.message)
				break
			}
			done.push(change)
		}
		// Drafts stay until the boards reload (the writes refetch them), so
		// cells do not flash back to their old values meanwhile.
		setSaved((prev) => {
			const out = new Map(prev)
			for (const change of done) {
				out.set(cellKey(change.column.provider, change.local.id), change.to)
			}
			return out
		})
		if (isTopLevel(kind())) {
			const linkedBy = new Map<IntegrationProvider, number[]>()
			for (const change of done) {
				if (change.to !== '' && change.to !== IGNORE) {
					const ids = linkedBy.get(change.column.provider) ?? []
					ids.push(change.local.id)
					linkedBy.set(change.column.provider, ids)
				}
			}
			// A run already in progress answers 409; the next sync covers them.
			// Site ids are no tenant filter: those sync everything.
			for (const [provider, ids] of linkedBy) {
				void start_sync(
					provider,
					kind() === 'tenant' && ids.length === 1 ? ids[0] : undefined,
				)
			}
		}
		setSaving(false)
	}

	// Rendering -------------------------------------------------------------------

	function kindOption(option: Kind): JSX.Element {
		return (
			<button
				type="button"
				class="link-board-filter-option"
				aria-pressed={kind() === option}
				onClick={(): void => switchKind(option)}
			>
				{kindNoun(option, 2)}
			</button>
		)
	}

	function filterOption(option: Filter, label: string, count: number): JSX.Element {
		return (
			<button
				type="button"
				class="link-board-filter-option"
				aria-pressed={filter() === option}
				onClick={(): void => {
					setFilter(option)
				}}
			>
				{label} <span class="badge">{count}</span>
			</button>
		)
	}

	function columnHead(column: Column): JSX.Element {
		const progress = (): { done: number; total: number } => columnProgress(column)
		const label = providerLabel(column.provider)
		return (
			<th class="matching-col" scope="col">
				<div class="matching-col-head">
					<span class="matching-col-title">{label}</span>
					<Show
						when={column.usable}
						fallback={
							<span class="badge badge-warning">{t('matching.tenantNotLinked')}</span>
						}
					>
						<span class="matching-col-count">
							{t('matching.columnProgress', {
								done: progress().done,
								total: progress().total,
							})}
						</span>
						<Show when={editable() && suggestionCount(column) > 0}>
							<button
								type="button"
								class="matching-suggest-all"
								title={t('matching.acceptColumn', { provider: label })}
								onClick={(): void => acceptSuggestions([column])}
							>
								<IconSparkles size={14} />
								{tp('matching.suggestedCount', suggestionCount(column))}
							</button>
						</Show>
					</Show>
				</div>
				<Show when={column.usable}>
					<div class="matching-col-bar" aria-hidden="true">
						<div
							style={{
								width: `${progress().total === 0 ? 0 : (100 * progress().done) / progress().total}%`,
							}}
						/>
					</div>
				</Show>
			</th>
		)
	}

	function cell(column: Column, row: MatchRow): JSX.Element {
		const local = (): LinkBoardLocal | undefined => column.local.get(row.id)
		const current = (): string => value(column, row.id)
		const changed = (): boolean => {
			const key = cellKey(column.provider, row.id)
			return drafts().has(key) && saved().get(key) !== drafts().get(key)
		}
		const label = providerLabel(column.provider)
		return (
			<td class="matching-cell" classList={{ changed: changed() }}>
				<Show
					when={column.usable && local()}
					fallback={
						<span class="text-muted" title={t('matching.tenantNotLinked')}>
							—
						</span>
					}
				>
					<div class="matching-pick" classList={{ ignored: current() === IGNORE }}>
						<Combobox
							class="combobox-fit"
							value={current()}
							onChange={
								editable()
									? (next: string): void => setCell(column, row.id, next)
									: undefined
							}
							options={column.options}
							ariaLabel={t('matching.pickLabel', { name: row.name, provider: label })}
							placeholder={t('matching.select')}
							searchLabel={t('common.search')}
							noMatchesLabel={t('common.noMatchingObjects')}
						/>
					</div>
					<Show when={suggestion(column, row.id)}>
						{(s: () => { external: LinkBoardExternal; via: string }): JSX.Element => (
							<div class="matching-suggestion">
								<button
									type="button"
									class="matching-suggestion-accept"
									disabled={!editable()}
									title={t('matching.acceptSuggestion')}
									onClick={(): void =>
										setCell(column, row.id, s().external.external_id)
									}
								>
									<IconSparkles size={14} />
									<span class="matching-suggestion-name">
										{s().external.name}
									</span>
									<span class="matching-suggestion-via">
										{t('integration.matchVia', {
											field: compareFieldLabel(s().via),
										})}
									</span>
								</button>
								<Show when={editable()}>
									<button
										type="button"
										class="icon-btn"
										title={t('integration.dismissSuggestion')}
										aria-label={t('integration.dismissSuggestion')}
										onClick={(): void => {
											setDismissed((prev) =>
												new Set(prev).add(cellKey(column.provider, row.id)),
											)
										}}
									>
										<IconX size={14} />
									</button>
								</Show>
							</div>
						)}
					</Show>
				</Show>
			</td>
		)
	}

	function rowStatus(row: MatchRow): JSX.Element {
		const open = (): number => rowStates(row.id).filter((s) => s === 'open').length
		return (
			<Show
				when={open() === 0}
				fallback={
					<span class="matching-status open" title={tp('matching.rowOpen', open())}>
						<IconCircleDashed size={16} />
						<span class="visually-hidden">{tp('matching.rowOpen', open())}</span>
					</span>
				}
			>
				<span class="matching-status done" title={t('matching.rowDone')}>
					<IconCircleCheck size={16} />
					<span class="visually-hidden">{t('matching.rowDone')}</span>
				</span>
			</Show>
		)
	}

	const objectPath = (id: number): string => `/${kind()}s/${id}`

	// Fixed dropdowns follow their field while anything scrolls or resizes.
	document.addEventListener('scroll', placeFocusedList, true)
	window.addEventListener('resize', placeFocusedList)
	onCleanup(() => {
		document.removeEventListener('scroll', placeFocusedList, true)
		window.removeEventListener('resize', placeFocusedList)
	})

	const table = (): JSX.Element => (
		<div
			class="matching-scroll"
			onFocusIn={(e: FocusEvent): void => {
				const box = (e.target as Element).closest<HTMLElement>('.combobox')
				if (box) {
					placeList(box)
				}
			}}
		>
			<table class="matching-table">
				<thead>
					<tr>
						<th class="matching-object" scope="col">
							{kindNoun(kind(), 1)}
						</th>
						<For each={columns()}>
							{(column: Column): JSX.Element => columnHead(column)}
						</For>
					</tr>
				</thead>
				<tbody>
					<For
						each={visibleRows()}
						fallback={
							<tr>
								<td class="text-muted" colspan={columns().length + 1}>
									{t('integration.noRows')}
								</td>
							</tr>
						}
					>
						{(row: MatchRow): JSX.Element => (
							<tr classList={{ inactive: !row.active }}>
								<th class="matching-object" scope="row">
									<div class="matching-object-line">
										{rowStatus(row)}
										<a href={objectPath(row.id)}>{row.name}</a>
										<Show when={!row.active}>
											<span class="badge">{t('integration.inactive')}</span>
										</Show>
									</div>
									<Show when={row.detail || row.serial}>
										<small class="link-board-detail">
											{[row.detail, row.serial].filter(Boolean).join(' · ')}
										</small>
									</Show>
								</th>
								<For each={columns()}>
									{(column: Column): JSX.Element => cell(column, row)}
								</For>
							</tr>
						)}
					</For>
				</tbody>
				<Show when={usableColumns().some((c) => leftover(c) > 0)}>
					<tfoot>
						<tr>
							<td class="text-muted">{t('matching.leftoverLabel')}</td>
							<For each={columns()}>
								{(column: Column): JSX.Element => (
									<td>
										<Show when={column.usable && leftover(column) > 0}>
											<a href={boardHref(column)}>
												{tp('matching.leftover', leftover(column))}
											</a>
										</Show>
									</td>
								)}
							</For>
						</tr>
					</tfoot>
				</Show>
			</table>
		</div>
	)

	return (
		<div class="matching-page">
			<div class="integrations-header">
				<span class="page-header-icon" aria-hidden="true">
					<IconArrowsJoin2 size={20} />
				</span>
				<div class="matching-heading">
					<h2>{t('matching.title')}</h2>
					<p class="text-muted">{t('matching.intro')}</p>
				</div>
			</div>

			<div class="toolbar-row matching-toolbar">
				<fieldset class="link-board-filter" aria-label={t('matching.kind')}>
					<Show when={!isScoped()}>{kindOption('tenant')}</Show>
					<Show when={!isScoped() && hasSiteLevel()}>{kindOption('site')}</Show>
					{kindOption('device')}
					{kindOption('employee')}
				</fieldset>
				<Show when={!isTopLevel(kind())}>
					<Combobox
						class="combobox-fit matching-tenant"
						value={tenant() === null ? '' : String(tenant())}
						onChange={switchTenant}
						options={(tenants() ?? []).map((r) => ({ value: r.id, label: r.name }))}
						ariaLabel={kindNoun('tenant', 1)}
						placeholder={t('matching.pickTenantShort')}
						searchLabel={t('common.search')}
						noMatchesLabel={t('common.noMatchingObjects')}
					/>
				</Show>
				<input
					type="search"
					class="toolbar-search-input link-board-search"
					aria-label={t('matching.search')}
					placeholder={t('matching.search')}
					value={search()}
					onInput={(e: InputEvent & { currentTarget: HTMLInputElement }): void => {
						setSearch(e.currentTarget.value)
					}}
				/>
				<fieldset class="link-board-filter" aria-label={t('integration.boardFilter')}>
					{filterOption('all', t('matching.filterAll'), searchedRows().length)}
					{filterOption(
						'open',
						t('matching.filterOpen'),
						searchedRows().filter((r) => !rowDone(r.id)).length,
					)}
					{filterOption(
						'done',
						t('matching.filterDone'),
						searchedRows().filter((r) => rowDone(r.id)).length,
					)}
				</fieldset>
				<Show when={editable() && totalSuggestions() > 0}>
					<button
						type="button"
						class="btn-outline"
						onClick={(): void => acceptSuggestions(usableColumns())}
					>
						<IconLabel icon={IconSparkles}>
							{tp('matching.acceptAll', totalSuggestions())}
						</IconLabel>
					</button>
				</Show>
			</div>

			<InlineError message={error()} />

			<Show
				when={integrations() === undefined || integrations.loading || enabled().length > 0}
				fallback={<Empty message={t('matching.noIntegrations')} />}
			>
				<Show
					when={isTopLevel(kind()) || tenant() !== null}
					fallback={<Empty message={t('matching.pickTenant')} />}
				>
					<Show
						when={boards()}
						fallback={
							<Show when={boards.loading || integrations.loading}>
								<Loading message={t('integration.loadingBoard')} />
							</Show>
						}
					>
						{table()}
					</Show>
				</Show>
			</Show>

			<Show when={boards() && rows().length > 0}>
				<div class="matching-footer">
					<span
						class="matching-summary"
						classList={{ complete: doneCount() === rows().length }}
					>
						<Show
							when={doneCount() === rows().length}
							fallback={<IconAlertCircle size={16} />}
						>
							<IconCircleCheck size={16} />
						</Show>
						{t('matching.progress', {
							done: doneCount(),
							total: rows().length,
							noun: kindNoun(kind(), rows().length),
						})}
					</span>
					<Show when={editable()}>
						<span class="matching-footer-actions">
							<Show when={changes().length > 0}>
								<span class="text-muted">
									{tp('matching.changes', changes().length)}
								</span>
							</Show>
							<button
								type="submit"
								disabled={changes().length === 0 || saving()}
								onClick={(): void => void save()}
							>
								<IconLabel icon={IconDeviceFloppy}>
									{saving() ? t('common.saving') : t('matching.save')}
								</IconLabel>
							</button>
							<button
								type="button"
								disabled={changes().length === 0 || saving()}
								onClick={discard}
							>
								{t('matching.discard')}
							</button>
						</span>
					</Show>
				</div>
			</Show>
		</div>
	)
}
