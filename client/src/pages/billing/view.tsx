/**
 * /billing — monthly lot counts of the managed bundles (`billing.manage`).
 * One period at a time: live counts while it runs, then the stored
 * snapshot (draft, then final). The tenant grid shows one column per
 * billed metric of each contracted bundle; a cell opens the objects behind
 * it with their changes against the previous snapshot. Stored backup data
 * is typed into its cell while the period is not final.
 */
import {
	IconAlertTriangle,
	IconChevronLeft,
	IconChevronRight,
	IconDownload,
	IconReceipt2,
	IconX,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type {
	BillingBundleJson,
	BillingExceptionJson,
	BillingExceptionKind,
	BillingItemType,
	BillingMetric,
	BillingMetricConfig,
} from 'shared/src/types'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import {
	type BillingCountJson,
	type BillingItemJson,
	type BillingOverviewJson,
	type BillingReportJson,
	billing_export_url,
	fetch_billing_changes,
	fetch_billing_items,
	fetch_billing_overview,
	fetch_billing_report,
	finalize_billing_period,
	save_billing_storage,
	take_billing_snapshot,
} from '../../api/billing'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { locale, t, tp } from '../../i18n'
import { billingExceptionLabel, billingMetricHint, billingMetricLabel } from '../../i18n/labels'
import { createRecord, useAction } from '../../lib/resource'
import { navigate, queryParam } from '../../lib/router'
import { formatTime } from '../../lib/time'

/** Exceptions listed per kind before "… and N more". */
const EXCEPTIONS_SHOWN = 5

type Tab = 'tenants' | 'bundles' | 'changes'

interface Line {
	tenant: number
	bundle: number
	metric: BillingMetric
}

/** Metrics whose cells list objects (the others are a fixed or typed-in value). */
function hasItems(metric: BillingMetric): boolean {
	return metric !== 'base' && metric !== 'storage'
}

function lineKey(tenant: number, bundle: number, metric: string): string {
	return `${tenant}:${bundle}:${metric}`
}

/** `2026-11` as "November 2026" in the UI language. */
function periodLabel(period: string): string {
	const [year, month] = period.split('-').map(Number)
	return new Intl.DateTimeFormat(locale(), {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1)))
}

/** Signed change of lots, or nothing without a previous value or change. */
function Delta(props: { lots: number; previous: number | null }): JSX.Element {
	const delta = (): number => (props.previous === null ? 0 : props.lots - props.previous)
	return (
		<Show when={delta() !== 0}>
			<span class={delta() > 0 ? 'billing-delta up' : 'billing-delta down'}>
				{delta() > 0 ? `+${delta()}` : `−${-delta()}`}
			</span>
		</Show>
	)
}

/** Link target of a billed object, if it has a page. */
function itemHref(item: { item_type: BillingItemType; ref_id: number | null }): string | null {
	if (item.ref_id === null) {
		return null
	}
	return item.item_type === 'vm' ? `/devices/vm/${item.ref_id}` : `/devices/${item.ref_id}`
}

function itemTypeLabel(type: BillingItemType): string {
	switch (type) {
		case 'device':
			return tp('entity.device', 1)
		case 'vm':
			return tp('entity.virtualMachine', 1)
		case 'interface':
			return t('billing.itemType.interface')
		default:
			return t('billing.itemType.m365User')
	}
}

function ItemName(props: { item: BillingItemJson | BillingExceptionJson }): JSX.Element {
	const href = (): string | null =>
		props.item.item_type === null
			? null
			: itemHref({ ...props.item, item_type: props.item.item_type })
	return (
		<Show when={href()} fallback={<span>{props.item.item_repr}</span>}>
			{(to: () => string) => <a href={to()}>{props.item.item_repr}</a>}
		</Show>
	)
}

/** Findings that are not billed, grouped by kind. */
function Exceptions(props: { exceptions: BillingExceptionJson[] }): JSX.Element {
	const groups = (): [BillingExceptionKind, BillingExceptionJson[]][] => {
		const byKind = new Map<BillingExceptionKind, BillingExceptionJson[]>()
		for (const e of props.exceptions) {
			byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e])
		}
		return [...byKind.entries()]
	}
	const where = (e: BillingExceptionJson): string =>
		[e.tenant_name, e.bundle_name].filter(Boolean).join(' · ')
	return (
		<Show when={props.exceptions.length > 0}>
			<section class="billing-callout" aria-labelledby="billing-exceptions">
				<h3 id="billing-exceptions">
					<IconAlertTriangle size={16} aria-hidden="true" />
					{tp('billing.exceptionsTitle', props.exceptions.length)}
				</h3>
				<For each={groups()}>
					{([kind, list]: [BillingExceptionKind, BillingExceptionJson[]]) => (
						<details>
							<summary>{billingExceptionLabel(kind, list.length)}</summary>
							<ul>
								<For each={list.slice(0, EXCEPTIONS_SHOWN)}>
									{(e: BillingExceptionJson) => (
										<li>
											<Show when={e.item_repr !== null}>
												<ItemName item={e} />
												<Show when={where(e)}> — </Show>
											</Show>
											<span class="text-muted">{where(e)}</span>
										</li>
									)}
								</For>
								<Show when={list.length > EXCEPTIONS_SHOWN}>
									<li class="text-muted">
										{t('billing.exceptionsMore', {
											count: list.length - EXCEPTIONS_SHOWN,
										})}
									</li>
								</Show>
							</ul>
						</details>
					)}
				</For>
			</section>
		</Show>
	)
}

/** Stored data in GB, saved on change; read-only once the period is final. */
function StorageCell(props: {
	count: BillingCountJson
	editable: boolean
	onSave: (gb: number | null) => void
}): JSX.Element {
	return (
		<Show
			when={props.editable}
			fallback={
				<span class="billing-gb">
					{t('billing.gb', { gb: props.count.quantity.toLocaleString(locale()) })}
				</span>
			}
		>
			<input
				type="number"
				class="billing-gb-input"
				classList={{ carried: props.count.carried }}
				min={0}
				step={1}
				inputmode="numeric"
				aria-label={t('billing.storageInput', { tenant: props.count.tenant_name })}
				title={props.count.carried ? t('billing.storageCarried') : undefined}
				value={props.count.carried || props.count.quantity > 0 ? props.count.quantity : ''}
				onChange={(e: Event & { currentTarget: HTMLInputElement }) => {
					const raw = e.currentTarget.value.trim()
					const gb = raw === '' ? null : Math.round(Number(raw))
					if (gb === null || (Number.isFinite(gb) && gb >= 0)) {
						props.onSave(gb)
					}
				}}
			/>
		</Show>
	)
}

/** Tenants × billed metrics, grouped by bundle. */
function TenantGrid(props: {
	report: BillingReportJson
	search: string
	editable: boolean
	selected: Line | null
	onSelect: (line: Line) => void
	onStorage: (count: BillingCountJson, gb: number | null) => void
}): JSX.Element {
	const counts = createMemo(
		() =>
			new Map(
				props.report.counts.map((c) => [lineKey(c.tenant_id, c.bundle_id, c.metric), c]),
			),
	)
	const tenants = createMemo(() => {
		const seen = new Map<number, BillingCountJson>()
		for (const c of props.report.counts) {
			if (!seen.has(c.tenant_id)) {
				seen.set(c.tenant_id, c)
			}
		}
		const term = props.search.trim().toLowerCase()
		return [...seen.values()].filter(
			(c) =>
				term === '' ||
				c.tenant_name.toLowerCase().includes(term) ||
				(c.customer_number ?? '').toLowerCase().includes(term),
		)
	})
	const total = (bundle: number, metric: BillingMetric): number =>
		props.report.counts
			.filter((c) => c.bundle_id === bundle && c.metric === metric)
			.reduce((sum, c) => sum + c.lots, 0)
	const columns = (): {
		bundle: BillingBundleJson
		config: BillingMetricConfig
		first: boolean
	}[] =>
		props.report.bundles.flatMap((bundle) =>
			bundle.metrics.map((config, i) => ({ bundle, config, first: i === 0 })),
		)
	const isSelected = (tenant: number, bundle: number, metric: string): boolean =>
		props.selected !== null &&
		props.selected.tenant === tenant &&
		props.selected.bundle === bundle &&
		props.selected.metric === metric

	return (
		<div class="billing-grid-wrap">
			<table class="billing-grid">
				<thead>
					<tr>
						<th rowSpan={2}>{tp('entity.tenant', 1)}</th>
						<th rowSpan={2}>{t('billing.customerNumber')}</th>
						<For each={props.report.bundles}>
							{(bundle: BillingBundleJson) => (
								<th colSpan={bundle.metrics.length} class="billing-group">
									<a href={`/managed-bundles/${bundle.id}`}>{bundle.name}</a>
								</th>
							)}
						</For>
					</tr>
					<tr>
						<For each={columns()}>
							{(col: { config: BillingMetricConfig; first: boolean }) => (
								<th
									class="num"
									classList={{ 'billing-group-start': col.first }}
									title={billingMetricHint(col.config.metric)}
								>
									{billingMetricLabel(col.config.metric)}
									<Show when={col.config.metric === 'switch_ports'}>
										{' '}
										<IconAlertTriangle
											size={12}
											class="billing-warn-icon"
											aria-label={t('billing.switchPortsWarning')}
										/>
									</Show>
								</th>
							)}
						</For>
					</tr>
				</thead>
				<tbody>
					<For each={tenants()}>
						{(tenant: BillingCountJson) => (
							<tr>
								<td>
									<a href={`/tenants/${tenant.tenant_id}`}>
										{tenant.tenant_name}
									</a>
								</td>
								<td class="text-muted">{tenant.customer_number ?? ''}</td>
								<For each={columns()}>
									{(col: {
										bundle: BillingBundleJson
										config: BillingMetricConfig
										first: boolean
									}) => {
										const count = (): BillingCountJson | undefined =>
											counts().get(
												lineKey(
													tenant.tenant_id,
													col.bundle.id,
													col.config.metric,
												),
											)
										const line = (): Line => ({
											tenant: tenant.tenant_id,
											bundle: col.bundle.id,
											metric: col.config.metric,
										})
										return (
											<td
												class="num"
												classList={{
													'billing-group-start': col.first,
													'billing-selected': isSelected(
														tenant.tenant_id,
														col.bundle.id,
														col.config.metric,
													),
												}}
												title={
													count()?.service_level_name ??
													t('billing.noContract')
												}
											>
												<Show
													when={count()}
													fallback={<span class="text-muted">—</span>}
												>
													{(c: () => BillingCountJson) => (
														<>
															<Show
																when={hasItems(c().metric)}
																fallback={
																	<span class="billing-lots">
																		{c().lots}
																	</span>
																}
															>
																<button
																	type="button"
																	class="billing-cell-button"
																	onClick={() =>
																		props.onSelect(line())
																	}
																>
																	{c().lots}
																</button>
															</Show>
															<Delta
																lots={c().lots}
																previous={c().previous_lots}
															/>
															<Show when={c().metric === 'storage'}>
																<StorageCell
																	count={c()}
																	editable={props.editable}
																	onSave={(gb: number | null) =>
																		props.onStorage(c(), gb)
																	}
																/>
															</Show>
															<Show when={col.first}>
																<span class="billing-sla">
																	{c().service_level_name}
																</span>
															</Show>
														</>
													)}
												</Show>
											</td>
										)
									}}
								</For>
							</tr>
						)}
					</For>
				</tbody>
				<tfoot>
					<tr>
						<td colSpan={2}>{t('billing.total')}</td>
						<For each={columns()}>
							{(col: {
								bundle: BillingBundleJson
								config: BillingMetricConfig
								first: boolean
							}) => (
								<td class="num" classList={{ 'billing-group-start': col.first }}>
									{total(col.bundle.id, col.config.metric)}
								</td>
							)}
						</For>
					</tr>
				</tfoot>
			</table>
		</div>
	)
}

interface BundleSum {
	bundle: string
	metric: BillingMetric
	level: string
	tenants: number
	lots: number
	previous: number | null
}

/** Lot totals per bundle, metric and service level. */
function BundleSummary(props: { report: BillingReportJson }): JSX.Element {
	const rows = (): BundleSum[] => {
		const sums = new Map<string, BundleSum>()
		const order = new Map(
			props.report.bundles.flatMap((b, i) =>
				b.metrics.map((m, j) => [`${b.id}:${m.metric}`, i * 100 + j] as const),
			),
		)
		const sorted = [...props.report.counts].sort(
			(a, b) =>
				(order.get(`${a.bundle_id}:${a.metric}`) ?? 0) -
					(order.get(`${b.bundle_id}:${b.metric}`) ?? 0) ||
				a.service_level_name.localeCompare(b.service_level_name),
		)
		for (const c of sorted) {
			const key = `${c.bundle_id}:${c.metric}:${c.service_level_name}`
			const sum = sums.get(key) ?? {
				bundle: c.bundle_name,
				metric: c.metric,
				level: c.service_level_name,
				tenants: 0,
				lots: 0,
				previous: null,
			}
			sum.tenants += 1
			sum.lots += c.lots
			if (c.previous_lots !== null) {
				sum.previous = (sum.previous ?? 0) + c.previous_lots
			}
			sums.set(key, sum)
		}
		return [...sums.values()]
	}
	return (
		<div class="billing-grid-wrap">
			<table class="billing-grid">
				<thead>
					<tr>
						<th>{tp('entity.managedBundle', 1)}</th>
						<th>{t('billing.metric')}</th>
						<th>{tp('entity.serviceLevel', 1)}</th>
						<th class="num">{tp('entity.tenant', 2)}</th>
						<th class="num">{t('billing.lotsColumn')}</th>
						<th class="num">{t('billing.previousColumn')}</th>
					</tr>
				</thead>
				<tbody>
					<For each={rows()}>
						{(row: BundleSum) => (
							<tr>
								<td>{row.bundle}</td>
								<td>{billingMetricLabel(row.metric)}</td>
								<td>{row.level}</td>
								<td class="num">{row.tenants}</td>
								<td class="num">
									<span class="billing-lots">{row.lots}</span>
									<Delta lots={row.lots} previous={row.previous} />
								</td>
								<td class="num text-muted">{row.previous ?? '—'}</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	)
}

/** Objects in a table: their kind, details and change tag; `line` adds the context columns. */
function ItemTable(props: { items: BillingItemJson[]; withLine?: boolean }): JSX.Element {
	return (
		<div class="billing-grid-wrap">
			<table class="billing-items">
				<thead>
					<tr>
						<Show when={props.withLine}>
							<th>{tp('entity.tenant', 1)}</th>
							<th>{tp('entity.managedBundle', 1)}</th>
							<th>{t('billing.metric')}</th>
						</Show>
						<th>{t('billing.object')}</th>
						<th>{t('billing.kind')}</th>
						<th>{t('billing.detail')}</th>
						<th />
					</tr>
				</thead>
				<tbody>
					<For each={props.items}>
						{(item: BillingItemJson) => (
							<tr classList={{ 'billing-removed': item.change === 'removed' }}>
								<Show when={props.withLine}>
									<td>{item.tenant_name}</td>
									<td>{item.bundle_name}</td>
									<td>{billingMetricLabel(item.metric)}</td>
								</Show>
								<td>
									<Show
										when={item.change !== 'removed'}
										fallback={<span>{item.item_repr}</span>}
									>
										<ItemName item={item} />
									</Show>
								</td>
								<td>{itemTypeLabel(item.item_type)}</td>
								<td class="text-muted">{item.detail ?? ''}</td>
								<td>
									<Show when={item.change}>
										{(change: () => 'added' | 'removed') => (
											<span class={`billing-tag ${change()}`}>
												{t(
													change() === 'added'
														? 'billing.change.added'
														: 'billing.change.removed',
												)}
											</span>
										)}
									</Show>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	)
}

/** Objects behind one cell. */
function ItemsPanel(props: {
	period: string
	line: Line
	report: BillingReportJson
	onClose: () => void
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [items] = createRecord(
		() => ({ period: props.period, line: props.line }),
		({ period, line }: { period: string; line: Line }) => fetch_billing_items(period, line),
		setError,
	)
	const count = (): BillingCountJson | undefined =>
		props.report.counts.find(
			(c) =>
				c.tenant_id === props.line.tenant &&
				c.bundle_id === props.line.bundle &&
				c.metric === props.line.metric,
		)
	return (
		<section class="billing-panel" aria-labelledby="billing-panel-title">
			<div class="billing-panel-header">
				<h3 id="billing-panel-title">
					{t('billing.itemsTitle', {
						tenant: count()?.tenant_name ?? '',
						bundle: count()?.bundle_name ?? '',
						metric: billingMetricLabel(props.line.metric),
					})}
					{' · '}
					{tp('billing.lots', count()?.lots ?? 0)}
					<Delta lots={count()?.lots ?? 0} previous={count()?.previous_lots ?? null} />
				</h3>
				<button type="button" class="icon-btn" onClick={() => props.onClose()}>
					<IconX size={16} aria-hidden="true" />
					<span class="visually-hidden">{t('common.close')}</span>
				</button>
			</div>
			<Show when={!items.loading} fallback={<Loading message={t('common.loading')} />}>
				<Show
					when={(items() ?? []).length > 0}
					fallback={<Empty message={t('billing.noItems')} />}
				>
					<ItemTable items={items() ?? []} />
				</Show>
			</Show>
			<InlineError message={error()} />
		</section>
	)
}

/** Every added or removed object of the period. */
function ChangesList(props: { period: string; previous: string | null }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [changes] = createRecord(() => props.period, fetch_billing_changes, setError)
	return (
		<Show when={props.previous} fallback={<Empty message={t('billing.noPrevious')} />}>
			{(previous: () => string) => (
				<Show when={!changes.loading} fallback={<Loading message={t('common.loading')} />}>
					<Show
						when={(changes() ?? []).length > 0}
						fallback={
							<Empty
								message={t('billing.noChanges', {
									period: periodLabel(previous()),
								})}
							/>
						}
					>
						<ItemTable items={changes() ?? []} withLine />
					</Show>
					<InlineError message={error()} />
				</Show>
			)}
		</Show>
	)
}

/**
 * The cutoff day: the period ends at the midnight after it (Europe/Berlin,
 * like the server), so the day is the one of the second before.
 */
function cutoffLabel(cutoffAt: number): string {
	return new Intl.DateTimeFormat(locale(), {
		dateStyle: 'medium',
		timeZone: 'Europe/Berlin',
	}).format(new Date((cutoffAt - 1) * 1000))
}

/** One line under the header: cutoff, snapshot and comparison. */
function metaLine(report: BillingReportJson, overview: BillingOverviewJson): string {
	const cutoff = cutoffLabel(report.cutoff_at)
	const snap = report.snapshot
	let text: string
	if (!snap) {
		text =
			report.period === overview.current_period
				? t('billing.metaLive', { cutoff })
				: t('billing.metaDue', { cutoff })
	} else {
		text = snap.taken_by
			? t('billing.metaTaken', {
					cutoff,
					time: formatTime(snap.taken_at),
					user: snap.taken_by,
				})
			: t('billing.metaTakenAuto', { cutoff, time: formatTime(snap.taken_at) })
		if (snap.finalized_at !== null) {
			text += t('billing.metaFinal', {
				time: formatTime(snap.finalized_at),
				user: snap.finalized_by ?? '',
			})
		}
	}
	if (report.previous_period) {
		text += t('billing.metaCompared', { period: periodLabel(report.previous_period) })
	}
	return text
}

/** Periods the picker offers: stored ones plus the due and the running one, newest first. */
function periodChoices(overview: BillingOverviewJson): string[] {
	const all = new Set([
		overview.current_period,
		overview.due_period,
		...overview.periods.map((p) => p.period),
	])
	return [...all].sort().reverse()
}

const loadOverview = (_: true): ReturnType<typeof fetch_billing_overview> =>
	fetch_billing_overview()

export function BillingPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [overview, overviewOps] = createRecord(() => true as const, loadOverview, setError)
	const [chosen, setChosen] = createSignal(queryParam('period'))
	const period = (): string | null => chosen() || overview()?.current_period || null
	const [report, reportOps] = createRecord(period, fetch_billing_report, setError, {
		keepPrevious: true,
	})
	const [tab, setTab] = createSignal<Tab>('tenants')
	const [search, setSearch] = createSignal('')
	const [selected, setSelected] = createSignal<Line | null>(null)
	const action = useAction(setError)

	const choices = (): string[] => {
		const o = overview()
		return o ? periodChoices(o) : []
	}
	function choose(next: string): void {
		setChosen(next)
		setSelected(null)
		navigate(`/billing?period=${next}`, { replace: true })
	}
	function step(delta: number): void {
		const list = choices()
		const i = list.indexOf(period() ?? '')
		const next = list[i - delta]
		if (next) {
			choose(next)
		}
	}
	const state = (): 'live' | 'draft' | 'final' => report()?.snapshot?.state ?? 'live'
	const canSnapshot = (): boolean => period() === overview()?.due_period && state() !== 'final'
	const editable = (): boolean => state() !== 'final'

	async function refresh(): Promise<void> {
		await Promise.all([overviewOps.refetch(), reportOps.refetch()])
	}
	async function snapshot(): Promise<void> {
		const p = period()
		if (
			!p ||
			(state() === 'draft' &&
				!window.confirm(t('billing.confirmRetake', { period: periodLabel(p) })))
		) {
			return
		}
		if (await action.run(() => take_billing_snapshot(p))) {
			setSelected(null)
			await refresh()
		}
	}
	async function finalize(): Promise<void> {
		const p = period()
		if (!p || !window.confirm(t('billing.confirmFinalize', { period: periodLabel(p) }))) {
			return
		}
		if (await action.run(() => finalize_billing_period(p))) {
			await refresh()
		}
	}
	async function saveStorage(count: BillingCountJson, gb: number | null): Promise<void> {
		const p = period()
		if (!p) {
			return
		}
		const res = await save_billing_storage(p, {
			tenant_id: count.tenant_id,
			bundle_id: count.bundle_id,
			gb,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		await reportOps.refetch()
	}

	return (
		<div class="billing-page">
			<div class="page-header">
				<div class="page-header-title">
					<span class="page-header-icon" aria-hidden="true">
						<IconReceipt2 size={20} />
					</span>
					<h2>{t('billing.title')}</h2>
					<Show when={period()}>
						{(p: () => string) => (
							<div class="billing-period">
								<button
									type="button"
									class="icon-btn"
									disabled={choices().indexOf(p()) >= choices().length - 1}
									onClick={() => step(-1)}
								>
									<IconChevronLeft size={16} aria-hidden="true" />
									<span class="visually-hidden">
										{t('billing.previousPeriod')}
									</span>
								</button>
								<select
									aria-label={t('billing.period')}
									value={p()}
									onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
										choose(e.currentTarget.value)
									}
								>
									<For each={choices()}>
										{(choice: string) => (
											<option value={choice} selected={choice === p()}>
												{periodLabel(choice)}
											</option>
										)}
									</For>
								</select>
								<button
									type="button"
									class="icon-btn"
									disabled={choices().indexOf(p()) <= 0}
									onClick={() => step(1)}
								>
									<IconChevronRight size={16} aria-hidden="true" />
									<span class="visually-hidden">{t('billing.nextPeriod')}</span>
								</button>
								<span class={`badge billing-state ${state()}`}>
									{t(`billing.state.${state()}`)}
								</span>
							</div>
						)}
					</Show>
				</div>
				<div class="page-header-actions">
					<Show when={state() === 'draft'}>
						<button
							type="button"
							class="billing-primary"
							disabled={action.pending()}
							onClick={() => void finalize()}
						>
							{t('billing.finalize')}
						</button>
					</Show>
					<Show when={canSnapshot()}>
						<button
							type="button"
							classList={{ 'billing-primary': state() === 'live' }}
							disabled={action.pending()}
							onClick={() => void snapshot()}
						>
							{state() === 'draft'
								? t('billing.retakeSnapshot')
								: t('billing.takeSnapshot')}
						</button>
					</Show>
					<Show when={period()}>
						{(p: () => string) => (
							<button
								type="button"
								onClick={() => window.location.assign(billing_export_url(p()))}
							>
								<IconLabel icon={IconDownload}>{t('billing.exportCsv')}</IconLabel>
							</button>
						)}
					</Show>
				</div>
			</div>

			<InlineError message={error()} />

			<Show
				when={report()}
				fallback={
					<Show when={report.loading || overview.loading}>
						<Loading message={t('billing.loading')} />
					</Show>
				}
			>
				{(r: () => BillingReportJson) => (
					<>
						<Show when={overview()}>
							{(o: () => BillingOverviewJson) => (
								<p class="page-subtitle">{metaLine(r(), o())}</p>
							)}
						</Show>

						<Exceptions exceptions={r().exceptions} />

						<Show
							when={r().bundles.some((b) =>
								b.metrics.some((m) => m.metric === 'switch_ports'),
							)}
						>
							<p class="billing-note">
								<IconAlertTriangle
									size={14}
									class="billing-warn-icon"
									aria-hidden="true"
								/>
								{t('billing.switchPortsWarning')}
							</p>
						</Show>

						<div class="billing-toolbar">
							<nav class="billing-tabs" aria-label={t('billing.title')}>
								<For
									each={
										[
											['tenants', t('billing.tabTenants')],
											['bundles', t('billing.tabBundles')],
											[
												'changes',
												t('billing.tabChanges', {
													added: r().added,
													removed: r().removed,
												}),
											],
										] as [Tab, string][]
									}
								>
									{([key, label]: [Tab, string]) => (
										<button
											type="button"
											aria-pressed={tab() === key}
											onClick={() => setTab(key)}
										>
											{label}
										</button>
									)}
								</For>
							</nav>
							<Show when={tab() === 'tenants'}>
								<input
									type="search"
									class="billing-search"
									placeholder={t('billing.searchTenant')}
									aria-label={t('billing.searchTenant')}
									value={search()}
									onInput={(
										e: InputEvent & { currentTarget: HTMLInputElement },
									) => setSearch(e.currentTarget.value)}
								/>
							</Show>
						</div>

						<Show
							when={r().counts.length > 0}
							fallback={<Empty message={t('billing.empty')} />}
						>
							<Show when={tab() === 'tenants'}>
								<TenantGrid
									report={r()}
									search={search()}
									editable={editable()}
									selected={selected()}
									onSelect={setSelected}
									onStorage={(c: BillingCountJson, gb: number | null) =>
										void saveStorage(c, gb)
									}
								/>
								<Show when={selected()}>
									{(line: () => Line) => (
										<ItemsPanel
											period={r().period}
											line={line()}
											report={r()}
											onClose={() => setSelected(null)}
										/>
									)}
								</Show>
							</Show>
							<Show when={tab() === 'bundles'}>
								<BundleSummary report={r()} />
							</Show>
						</Show>
						<Show when={tab() === 'changes'}>
							<ChangesList period={r().period} previous={r().previous_period} />
						</Show>
					</>
				)}
			</Show>
		</div>
	)
}
