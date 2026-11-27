/**
 * Outlook calendar sync (TANSS appointments → Outlook), laid out like a
 * provider (design decision 0006): an `IntegrationCard` on the integrations
 * page that opens /integrations/calendar-sync, whose header carries the
 * status, the Enabled switch and "Sync now", with tabs for the technician →
 * mailbox mapping and the settings (Microsoft 365 app, schedule, removal).
 * Global `integrations.manage` only, like the routes.
 */
import { IconCalendarEvent, IconPlus } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { CALENDAR_SYNC_MAX_INTERVAL, CALENDAR_SYNC_MIN_INTERVAL } from 'shared/src/schemas'
import type { InputEventAndTarget } from 'shared/src/types'
import { type Accessor, createEffect, createSignal, For, type JSX, on, Show } from 'solid-js'
import {
	type CalendarSyncConfigJson,
	type CalendarSyncRunJson,
	type CalendarTechnicianJson,
	delete_calendar_mapping,
	delete_calendar_sync_config,
	fetch_calendar_sync_config,
	fetch_calendar_sync_runs,
	fetch_calendar_technicians,
	save_calendar_mapping,
	save_calendar_sync_config,
	start_calendar_sync,
	test_calendar_sync_config,
	wait_for_calendar_sync,
} from '../../api/calendar_sync'
import { fetch_integrations } from '../../api/integrations'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { Field, Hint, TextField } from '../../components/form'
import { IconLabel } from '../../components/icon_label'
import { t } from '../../i18n'
import { createRecord, createRows, useAction } from '../../lib/resource'
import { forgetDeleted, navigate, queryParam, usePageMeta } from '../../lib/router'
import {
	DangerZone,
	type DetailTab,
	DetailTabs,
	IntegrationDetailHeader,
	SettingsSection,
	settingsHref,
} from './detail_parts'
import { type TestResult, TestResultLine } from './form_fields'
import {
	IntegrationCard,
	IntegrationModeBanner,
	type IntegrationStatus,
	LastRunError,
	LastRunTime,
	StatusPill,
	SyncIconButton,
	WarningPill,
} from './integration_card'

/** Detail page of the calendar sync. */
export const CALENDAR_SYNC_HREF = '/integrations/calendar-sync'

/** Unsaved credentials of the settings form. */
interface Credentials {
	ms_tenant_id: string
	client_id: string
	client_secret?: string
}

/**
 * Settings tab: the sync interval (saved on change once set up), the
 * Microsoft 365 app with its connection test, and the danger zone once set up. The first save turns the sync
 * on; afterwards the header's switch does.
 */
function SettingsPanel(props: {
	config: CalendarSyncConfigJson
	onSaved: (config: CalendarSyncConfigJson) => void
	onRemoved: () => void
}): JSX.Element {
	const [tenantId, setTenantId] = createSignal(props.config.ms_tenant_id)
	const [clientId, setClientId] = createSignal(props.config.client_id)
	const [secret, setSecret] = createSignal('')
	const [interval, setIntervalMinutes] = createSignal(String(props.config.interval_minutes))
	const [testMailbox, setTestMailbox] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [testing, setTesting] = createSignal(false)
	const [testResult, setTestResult] = createSignal<TestResult | null>(null)
	const [saved, setSaved] = createSignal(false)
	const [intervalSaved, setIntervalSaved] = createSignal(false)
	const action = useAction(setError)
	const intervalAction = useAction(setError)
	const remove = useAction(setError)

	const credentials = (): Credentials => ({
		ms_tenant_id: tenantId().trim(),
		client_id: clientId().trim(),
		...(secret() !== '' ? { client_secret: secret() } : {}),
	})

	async function handleTest(): Promise<void> {
		setTesting(true)
		setTestResult(null)
		const mailbox = testMailbox().trim()
		const res = await test_calendar_sync_config({
			...credentials(),
			...(mailbox !== '' ? { mailbox_upn: mailbox } : {}),
		})
		setTesting(false)
		setTestResult(
			Result.isError(res)
				? { ok: false, message: res.error.message }
				: {
						ok: true,
						message:
							mailbox !== ''
								? t('calendarSync.testOkMailbox', { mailbox })
								: t('calendarSync.testOk'),
					},
		)
	}

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setSaved(false)
		let next: CalendarSyncConfigJson | null = null
		const ok = await action.run(async () => {
			const res = await save_calendar_sync_config({
				...credentials(),
				enabled: props.config.configured ? props.config.enabled : true,
				interval_minutes: Number(interval()),
			})
			if (Result.isOk(res)) {
				next = res.value
			}
			return res
		})
		if (ok && next) {
			setSecret('')
			setSaved(true)
			props.onSaved(next)
		}
	}

	/**
	 * Once set up, a valid interval saves on its own (stored settings, no new
	 * sign-in); before that it goes with the first save.
	 */
	async function handleIntervalChange(): Promise<void> {
		const minutes = Number(interval())
		if (
			!props.config.configured ||
			!Number.isInteger(minutes) ||
			minutes < CALENDAR_SYNC_MIN_INTERVAL ||
			minutes > CALENDAR_SYNC_MAX_INTERVAL ||
			minutes === props.config.interval_minutes
		) {
			return
		}
		let next: CalendarSyncConfigJson | null = null
		const ok = await intervalAction.run(async () => {
			const res = await saveStored(props.config, { interval_minutes: minutes })
			if (Result.isOk(res)) {
				next = res.value
			}
			return res
		})
		if (ok && next) {
			setIntervalSaved(true)
			props.onSaved(next)
		}
	}

	async function handleRemove(): Promise<void> {
		if (!window.confirm(t('calendarSync.confirmRemoveSync'))) {
			return
		}
		if (await remove.run(() => delete_calendar_sync_config())) {
			props.onRemoved()
		}
	}

	return (
		<div class="integration-settings">
			<form class="form-stacked" onSubmit={(e: SubmitEvent) => void handleSave(e)}>
				<SettingsSection title={t('integration.schedule')}>
					<TextField
						id="calendar-sync-interval"
						label={t('calendarSync.interval')}
						type="number"
						required
						min={CALENDAR_SYNC_MIN_INTERVAL}
						max={CALENDAR_SYNC_MAX_INTERVAL}
						step={1}
						value={interval()}
						onInput={(value: string) => {
							setIntervalSaved(false)
							setIntervalMinutes(value)
						}}
						onChange={() => void handleIntervalChange()}
						hint={
							<Show when={intervalSaved() && !intervalAction.pending()}>
								<span class="text-success" role="status">
									{t('integration.saved')}
								</span>
							</Show>
						}
					/>
				</SettingsSection>
				<SettingsSection title={t('calendarSync.settings')}>
					<TextField
						id="calendar-sync-tenant-id"
						label={t('calendarSync.tenantId')}
						required
						maxLength={200}
						autocomplete="off"
						placeholder="contoso.onmicrosoft.com"
						value={tenantId()}
						onInput={setTenantId}
						hint={<Hint>{t('calendarSync.tenantIdHint')}</Hint>}
					/>
					<TextField
						id="calendar-sync-client-id"
						label={t('calendarSync.clientId')}
						required
						maxLength={36}
						autocomplete="off"
						placeholder="00000000-0000-0000-0000-000000000000"
						value={clientId()}
						onInput={setClientId}
					/>
					<TextField
						id="calendar-sync-client-secret"
						label={t('calendarSync.clientSecret')}
						type="password"
						required={!props.config.has_secret}
						placeholder={
							props.config.has_secret ? t('integration.keepSecret') : undefined
						}
						autocomplete="new-password"
						value={secret()}
						onInput={setSecret}
					/>
					<Field label={t('integration.connection')} for="calendar-sync-test-mailbox">
						<div class="input-with-button">
							<input
								id="calendar-sync-test-mailbox"
								type="email"
								autocomplete="off"
								placeholder={t('calendarSync.testMailbox')}
								aria-label={t('calendarSync.testMailbox')}
								value={testMailbox()}
								onInput={(e: InputEventAndTarget) =>
									setTestMailbox(e.currentTarget.value)
								}
							/>
							<button
								type="button"
								disabled={testing()}
								onClick={() => void handleTest()}
							>
								{testing() ? t('integration.testing') : t('integration.test')}
							</button>
						</div>
						<TestResultLine result={testResult()} />
					</Field>
				</SettingsSection>
				<div class="form-actions">
					<button type="submit" disabled={action.pending()}>
						{action.pending()
							? t('common.saving')
							: props.config.configured
								? t('common.save')
								: t('calendarSync.saveAndEnable')}
					</button>
					<Show when={saved() && !action.pending()}>
						<span class="text-success" role="status">
							{t('integration.saved')}
						</span>
					</Show>
				</div>
			</form>
			<InlineError message={error()} />
			<Show when={props.config.configured}>
				<DangerZone
					name={t('calendarSync.title')}
					pending={remove.pending()}
					onRemove={() => void handleRemove()}
				/>
			</Show>
		</div>
	)
}

/** One technician: mailbox input, enabled toggle, save / remove. */
function TechnicianRow(props: {
	technician: CalendarTechnicianJson
	onChanged: () => void
	setError: (message: string | null) => void
}): JSX.Element {
	const mapping = (): CalendarTechnicianJson['mapping'] => props.technician.mapping
	const [mailbox, setMailbox] = createSignal(
		props.technician.mapping?.mailbox_upn ?? props.technician.email ?? '',
	)
	const [enabled, setEnabled] = createSignal(props.technician.mapping?.enabled ?? true)
	const action = useAction(props.setError)
	const id = (): number => props.technician.tanss_employee_id

	async function handleSave(): Promise<void> {
		const ok = await action.run(() =>
			save_calendar_mapping(id(), { mailbox_upn: mailbox().trim(), enabled: enabled() }),
		)
		if (ok) {
			props.onChanged()
		}
	}

	async function handleRemove(): Promise<void> {
		if (!window.confirm(t('calendarSync.confirmRemove', { name: props.technician.name }))) {
			return
		}
		if (await action.run(() => delete_calendar_mapping(id()))) {
			props.onChanged()
		}
	}

	return (
		<tr>
			<td>{props.technician.name}</td>
			<td>
				<input
					type="email"
					autocomplete="off"
					aria-label={t('calendarSync.mailboxFor', { name: props.technician.name })}
					value={mailbox()}
					onInput={(e: InputEventAndTarget) => setMailbox(e.currentTarget.value)}
				/>
			</td>
			<td>
				<input
					type="checkbox"
					aria-label={t('calendarSync.enabledFor', { name: props.technician.name })}
					checked={enabled()}
					onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
						setEnabled(e.currentTarget.checked)
					}
				/>
			</td>
			<td>
				<div class="form-actions">
					<button
						type="button"
						disabled={action.pending() || mailbox().trim() === ''}
						onClick={() => void handleSave()}
					>
						{mapping() ? t('common.save') : t('calendarSync.map')}
					</button>
					<Show when={mapping()}>
						<button
							type="button"
							class="btn-danger"
							disabled={action.pending()}
							onClick={() => void handleRemove()}
						>
							{t('calendarSync.unmap')}
						</button>
					</Show>
				</div>
			</td>
		</tr>
	)
}

/** Technicians tab: TANSS technicians with their mailbox mapping. */
function TechniciansPanel(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [technicians, { refetch }] = createRows(fetch_calendar_technicians, setError)
	return (
		<div>
			<p class="field-hint">{t('calendarSync.techniciansHint')}</p>
			<Show
				when={!technicians.loading || technicians() !== undefined}
				fallback={<Loading message={t('calendarSync.loadingTechnicians')} />}
			>
				<Show
					when={(technicians() ?? []).length > 0}
					fallback={<Empty message={t('calendarSync.noTechnicians')} />}
				>
					<table>
						<thead>
							<tr>
								<th>{t('calendarSync.technician')}</th>
								<th>{t('calendarSync.mailbox')}</th>
								<th>{t('calendarSync.enabled')}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							<For each={technicians()}>
								{(tech: CalendarTechnicianJson): JSX.Element => (
									<TechnicianRow
										technician={tech}
										onChanged={() => void refetch()}
										setError={setError}
									/>
								)}
							</For>
						</tbody>
					</table>
				</Show>
			</Show>
			<InlineError message={error()} />
		</div>
	)
}

/** Enabled, but the sign-in or the latest run failed (header summary). */
export function calendarNeedsAttention(config: CalendarSyncConfigJson | null): boolean {
	return (
		config?.configured === true &&
		config.enabled &&
		(config.last_error !== null || config.last_run?.state === 'error')
	)
}

/** State of the configured sync; `running` covers a run followed from here. */
function syncStatus(config: CalendarSyncConfigJson, running: boolean): IntegrationStatus {
	if (!config.enabled) {
		return 'disabled'
	}
	if (config.last_error) {
		return 'error'
	}
	return running ? 'running' : 'connected'
}

/**
 * Run history with "Sync now": a run already in progress (sweep or another
 * admin) is followed too, and every finished run refreshes the list.
 */
function useCalendarRuns(setError: (message: string | null) => void): {
	lastRun: Accessor<CalendarSyncRunJson | null>
	syncing: Accessor<boolean>
	sync: () => Promise<void>
} {
	const [syncing, setSyncing] = createSignal(false)
	const [runs, { refetch }] = createRows(fetch_calendar_sync_runs, setError)

	createEffect(
		on(runs, (rows) => {
			const current = rows?.[0]
			if (current?.state === 'running' && !syncing()) {
				void follow(current.id)
			}
		}),
	)

	async function follow(id: number): Promise<void> {
		setSyncing(true)
		const done = await wait_for_calendar_sync(id)
		setSyncing(false)
		if (Result.isError(done)) {
			setError(done.error.message)
		}
		void refetch()
	}

	async function sync(): Promise<void> {
		setError(null)
		const started = await start_calendar_sync()
		if (Result.isError(started)) {
			setError(started.error.message)
			return
		}
		await follow(started.value.id)
	}

	return { lastRun: () => runs()?.[0] ?? null, syncing, sync }
}

/** Saves the stored settings with `enabled` or the interval changed (no new sign-in). */
function saveStored(
	config: CalendarSyncConfigJson,
	changes: { enabled?: boolean; interval_minutes?: number },
): ReturnType<typeof save_calendar_sync_config> {
	return save_calendar_sync_config({
		ms_tenant_id: config.ms_tenant_id,
		client_id: config.client_id,
		enabled: config.enabled,
		interval_minutes: config.interval_minutes,
		...changes,
	})
}

type View = 'technicians' | 'settings'

/**
 * /integrations/calendar-sync — detail page of the calendar sync
 * (design decision 0006). Before setup only the Settings tab shows; without TANSS
 * the page only says it needs it.
 */
export function CalendarSyncDetailPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [integrations] = createRows(fetch_integrations, setError)
	const tanssReady = (): boolean => (integrations() ?? []).some((i) => i.provider === 'tanss')
	const [config, { mutate }] = createRecord(() => true, fetch_calendar_sync_config, setError)
	const runs = useCalendarRuns(setError)
	const toggle = useAction(setError)
	const [view, setView] = createSignal<View>(
		queryParam('view') === 'settings' ? 'settings' : 'technicians',
	)
	usePageMeta(() => ({ name: t('calendarSync.title') }))

	const configured = (): boolean => config()?.configured === true
	const activeView = (): View => (configured() ? view() : 'settings')
	const tabs = (): DetailTab<View>[] => [
		...(configured()
			? [{ key: 'technicians' as const, label: t('calendarSync.viewTechnicians') }]
			: []),
		{ key: 'settings', label: t('integration.settings') },
	]

	async function handleToggle(enabled: boolean): Promise<void> {
		const current = config()
		if (!current) {
			return
		}
		await toggle.run(async () => {
			const res = await saveStored(current, { enabled })
			if (Result.isOk(res)) {
				mutate(res.value)
			}
			return res
		})
	}

	return (
		<div class="integration-detail">
			<IntegrationModeBanner />
			<Show
				when={!config.loading || config() !== undefined}
				fallback={<Loading message={t('calendarSync.loading')} />}
			>
				<Show when={config()}>
					{(c: () => CalendarSyncConfigJson): JSX.Element => (
						<>
							<IntegrationDetailHeader
								name={t('calendarSync.title')}
								description={t('calendarSync.description')}
								icon={IconCalendarEvent}
								configured={c().configured}
								status={syncStatus(c(), runs.syncing())}
								lastSyncFailed={runs.lastRun()?.state === 'error'}
								lastRun={runs.lastRun()}
								connectionError={c().last_error}
								manageable
								enabled={c().enabled}
								toggling={toggle.pending()}
								onToggle={(enabled: boolean) => void handleToggle(enabled)}
								syncing={runs.syncing()}
								onSync={() => void runs.sync()}
								menuActions={[]}
							/>
							<InlineError message={error()} />
							<Show
								when={tanssReady() || integrations.loading}
								fallback={<Empty message={t('calendarSync.requiresTanss')} />}
							>
								<DetailTabs
									label={t('integration.views')}
									tabs={tabs()}
									active={activeView()}
									onSelect={(key: View) => {
										setError(null)
										setView(key)
									}}
								/>
								<Show when={activeView() === 'technicians'}>
									<TechniciansPanel />
								</Show>
								<Show when={activeView() === 'settings'}>
									<SettingsPanel
										config={c()}
										onSaved={(saved: CalendarSyncConfigJson): void => {
											const first = !c().configured
											mutate(saved)
											if (first) {
												setView('technicians')
											}
										}}
										onRemoved={(): void =>
											forgetDeleted(CALENDAR_SYNC_HREF, '/integrations')
										}
									/>
								</Show>
							</Show>
						</>
					)}
				</Show>
			</Show>
		</div>
	)
}

/** Status pills and last sync time of the configured sync. */
function SyncStatus(props: {
	config: CalendarSyncConfigJson
	status: IntegrationStatus
	lastRun: CalendarSyncRunJson | null
}): JSX.Element {
	return (
		<>
			<StatusPill status={props.status} />
			<Show when={props.config.enabled && props.lastRun?.state === 'error'}>
				<WarningPill>{t('integration.lastSyncFailed')}</WarningPill>
			</Show>
			<LastRunTime run={props.lastRun} />
		</>
	)
}

/** Connection and sync errors of the configured sync. */
function SyncErrors(props: {
	config: CalendarSyncConfigJson
	lastRun: CalendarSyncRunJson | null
}): JSX.Element {
	return (
		<>
			<Show when={props.config.enabled && props.config.last_error}>
				<p class="integration-error">{props.config.last_error}</p>
			</Show>
			<LastRunError
				run={props.lastRun}
				shown={props.config.enabled ? props.config.last_error : null}
			/>
		</>
	)
}

/**
 * Card of the calendar sync on the integrations page (`integrations.manage`,
 * global): opens the detail page; "Set up" and "Settings" open its Settings
 * tab.
 */
function ConfigurableSyncCard(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [config] = createRecord(() => true, fetch_calendar_sync_config, setError)
	const runs = useCalendarRuns(setError)
	const status = (c: CalendarSyncConfigJson): IntegrationStatus => syncStatus(c, runs.syncing())

	return (
		<Show
			when={config()}
			fallback={
				<IntegrationCard
					name={t('calendarSync.title')}
					description={t('calendarSync.description')}
					icon={IconCalendarEvent}
					href={CALENDAR_SYNC_HREF}
					details={<Loading message={t('calendarSync.loading')} />}
				/>
			}
		>
			{(c: () => CalendarSyncConfigJson): JSX.Element => (
				<IntegrationCard
					name={t('calendarSync.title')}
					description={t('calendarSync.description')}
					icon={IconCalendarEvent}
					href={c().configured ? CALENDAR_SYNC_HREF : settingsHref(CALENDAR_SYNC_HREF)}
					tone={
						!c().configured
							? undefined
							: status(c()) === 'error'
								? 'error'
								: status(c()) === 'disabled'
									? 'disabled'
									: undefined
					}
					status={
						c().configured ? (
							<SyncStatus
								config={c()}
								status={status(c())}
								lastRun={runs.lastRun()}
							/>
						) : undefined
					}
					details={
						c().configured || error() !== null ? (
							<>
								<Show when={c().configured}>
									<SyncErrors config={c()} lastRun={runs.lastRun()} />
								</Show>
								<InlineError message={error()} />
							</>
						) : undefined
					}
					action={
						<Show
							when={c().configured}
							fallback={
								<button
									type="button"
									class="integration-card-btn"
									onClick={() => navigate(settingsHref(CALENDAR_SYNC_HREF))}
								>
									<IconLabel icon={IconPlus}>{t('integration.setUp')}</IconLabel>
								</button>
							}
						>
							<SyncIconButton
								syncing={runs.syncing()}
								disabled={!c().enabled}
								onClick={() => void runs.sync()}
							/>
						</Show>
					}
				/>
			)}
		</Show>
	)
}

/**
 * The calendar sync card; while TANSS is not set up it only says so, since
 * the sync reads its appointments from there.
 */
export function CalendarSyncCard(props: { blocked: boolean }): JSX.Element {
	return (
		<Show
			when={!props.blocked}
			fallback={
				<IntegrationCard
					name={t('calendarSync.title')}
					description={t('calendarSync.description')}
					icon={IconCalendarEvent}
					details={<p class="integration-meta">{t('calendarSync.requiresTanss')}</p>}
					action={
						<button type="button" class="integration-card-btn" disabled>
							<IconLabel icon={IconPlus}>{t('integration.setUp')}</IconLabel>
						</button>
					}
				/>
			}
		>
			<ConfigurableSyncCard />
		</Show>
	)
}
