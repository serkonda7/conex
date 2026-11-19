/**
 * Calendar sync card on the integrations page (TANSS appointments →
 * Outlook), an `IntegrationCard` like the providers': "Sync now" in the
 * footer, "Edit" in the ⋯ menu, which swaps the card for the settings form
 * with its connection test. The technician → mailbox mappings live on their
 * own page (/integrations/calendar-sync), linked from the card like the
 * TANSS consistency report. Global `integrations.manage` only, like the routes.
 */
import { IconCalendarEvent, IconPencil, IconPlus, IconRefresh } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { CALENDAR_SYNC_MAX_INTERVAL, CALENDAR_SYNC_MIN_INTERVAL } from 'shared/src/schemas'
import type { InputEventAndTarget } from 'shared/src/types'
import { createEffect, createSignal, For, type JSX, on, Show } from 'solid-js'
import {
	type CalendarSyncConfigJson,
	type CalendarSyncRunJson,
	type CalendarTechnicianJson,
	delete_calendar_mapping,
	fetch_calendar_sync_config,
	fetch_calendar_sync_runs,
	fetch_calendar_technicians,
	save_calendar_mapping,
	save_calendar_sync_config,
	start_calendar_sync,
	test_calendar_sync_config,
	wait_for_calendar_sync,
} from '../../api/calendar_sync'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { Field, Hint, TextField, ToggleField } from '../../components/form'
import { IconLabel } from '../../components/icon_label'
import { RowMenu, useRowMenu } from '../../components/list_page'
import { MoreActionsButton } from '../../components/more_actions_button'
import { t } from '../../i18n'
import { createRecord, createRows, useAction } from '../../lib/resource'
import { usePageMeta } from '../../lib/router'
import { type TestResult, TestResultLine } from './form_fields'
import {
	IntegrationCard,
	type IntegrationStatus,
	LastRunLine,
	StatusPill,
	WarningPill,
} from './integration_card'

/** Credentials, schedule and the connection test. */
function SettingsForm(props: {
	config: CalendarSyncConfigJson
	onSaved: (config: CalendarSyncConfigJson) => void
	onCancel: () => void
}): JSX.Element {
	const [tenantId, setTenantId] = createSignal(props.config.ms_tenant_id)
	const [clientId, setClientId] = createSignal(props.config.client_id)
	const [secret, setSecret] = createSignal('')
	const [enabled, setEnabled] = createSignal(props.config.enabled)
	const [interval, setIntervalMinutes] = createSignal(String(props.config.interval_minutes))
	const [testMailbox, setTestMailbox] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [testing, setTesting] = createSignal(false)
	const [testResult, setTestResult] = createSignal<TestResult | null>(null)
	const action = useAction(setError)

	const credentials = (): {
		ms_tenant_id: string
		client_id: string
		client_secret?: string
	} => ({
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
		let saved: CalendarSyncConfigJson | null = null
		const ok = await action.run(async () => {
			const res = await save_calendar_sync_config({
				...credentials(),
				enabled: enabled(),
				interval_minutes: Number(interval()),
			})
			if (Result.isOk(res)) {
				saved = res.value
			}
			return res
		})
		if (ok && saved) {
			setSecret('')
			props.onSaved(saved)
		}
	}

	return (
		<form
			class="form-stacked calendar-sync-form"
			onSubmit={(e: SubmitEvent) => void handleSave(e)}
		>
			<ToggleField
				id="calendar-sync-enabled"
				label={t('common.status')}
				checked={enabled()}
				onChange={setEnabled}
				on_text={t('integration.enabled')}
				off_text={t('integration.disabled')}
			/>
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
				placeholder={props.config.has_secret ? t('integration.keepSecret') : undefined}
				autocomplete="new-password"
				value={secret()}
				onInput={setSecret}
			/>
			<TextField
				id="calendar-sync-interval"
				label={t('calendarSync.interval')}
				type="number"
				required
				min={CALENDAR_SYNC_MIN_INTERVAL}
				max={CALENDAR_SYNC_MAX_INTERVAL}
				step={1}
				value={interval()}
				onInput={setIntervalMinutes}
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
						onInput={(e: InputEventAndTarget) => setTestMailbox(e.currentTarget.value)}
					/>
					<button type="button" disabled={testing()} onClick={() => void handleTest()}>
						{testing() ? t('integration.testing') : t('integration.test')}
					</button>
				</div>
				<TestResultLine result={testResult()} />
			</Field>
			<InlineError message={error()} />
			<div class="form-actions">
				<button type="submit" disabled={action.pending()}>
					{action.pending() ? t('common.saving') : t('common.save')}
				</button>
				<button type="button" onClick={() => props.onCancel()}>
					{t('common.cancel')}
				</button>
			</div>
		</form>
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

/**
 * /integrations/calendar-sync — TANSS technicians with their mailbox
 * mapping, opened from the calendar sync card.
 */
export function CalendarSyncTechniciansPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [technicians, { refetch }] = createRows(fetch_calendar_technicians, setError)
	usePageMeta(() => ({ name: t('calendarSync.techniciansTitle') }))
	return (
		<div>
			<div class="page-header">
				<h2>{t('calendarSync.techniciansTitle')}</h2>
			</div>
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

/** Card state of the configured sync; `running` covers a run followed from here. */
function syncStatus(config: CalendarSyncConfigJson, running: boolean): IntegrationStatus {
	if (!config.enabled) {
		return 'disabled'
	}
	if (config.last_error) {
		return 'error'
	}
	return running ? 'running' : 'connected'
}

/** "Edit" behind the ⋯ button of the configured sync. */
function SyncMenu(props: { onEdit: () => void }): JSX.Element {
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()
	return (
		<>
			<MoreActionsButton
				name={t('calendarSync.title')}
				open={openMenu() !== null}
				onToggle={(e: MouseEvent & { currentTarget: HTMLButtonElement }) =>
					toggleMenu(e, 'calendar-sync', t('calendarSync.title'))
				}
				onClose={closeMenu}
			/>
			<RowMenu
				menu={openMenu}
				onClose={closeMenu}
				cloneHref={() => undefined}
				actions={() => [
					{ label: t('common.edit'), icon: IconPencil, onSelect: props.onEdit },
				]}
				deletable={() => false}
				onDelete={() => undefined}
			/>
		</>
	)
}

/** Status pills, last sync time and errors of the configured sync. */
function SyncDetails(props: {
	config: CalendarSyncConfigJson
	status: IntegrationStatus
	lastRun: CalendarSyncRunJson | null
}): JSX.Element {
	return (
		<>
			<div class="integration-status">
				<StatusPill status={props.status} />
				<Show when={props.config.enabled && props.lastRun?.state === 'error'}>
					<WarningPill>{t('integration.lastSyncFailed')}</WarningPill>
				</Show>
			</div>
			<Show when={props.config.enabled && props.config.last_error}>
				<p class="integration-error">{props.config.last_error}</p>
			</Show>
			<LastRunLine run={props.lastRun} />
		</>
	)
}

/**
 * Calendar sync card on the integrations page (`integrations.manage`,
 * global): "Set up" or "Edit" swaps the card for the settings form across
 * the whole row; the technician mapping has its own page.
 */
function ConfigurableSyncCard(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [syncing, setSyncing] = createSignal(false)
	const [config, { mutate }] = createRecord(() => true, fetch_calendar_sync_config, setError)
	const [runs, { refetch: refetchRuns }] = createRows(fetch_calendar_sync_runs, setError)

	// A run already in progress (sweep or another admin) is followed too.
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
		void refetchRuns()
	}

	async function handleSync(): Promise<void> {
		setError(null)
		const started = await start_calendar_sync()
		if (Result.isError(started)) {
			setError(started.error.message)
			return
		}
		await follow(started.value.id)
	}

	const [editing, setEditing] = createSignal(false)
	const status = (c: CalendarSyncConfigJson): IntegrationStatus => syncStatus(c, syncing())
	const canSync = (): boolean => {
		const c = config()
		return c?.configured === true && c.enabled && !syncing()
	}

	return (
		<Show
			when={config()}
			fallback={
				<IntegrationCard
					name={t('calendarSync.title')}
					description={t('calendarSync.description')}
					icon={IconCalendarEvent}
					details={<Loading message={t('calendarSync.loading')} />}
				/>
			}
		>
			{(c: () => CalendarSyncConfigJson): JSX.Element => (
				<IntegrationCard
					name={t('calendarSync.title')}
					description={t('calendarSync.description')}
					icon={IconCalendarEvent}
					tone={
						!c().configured
							? undefined
							: status(c()) === 'error'
								? 'error'
								: status(c()) === 'disabled'
									? 'disabled'
									: undefined
					}
					form={
						editing() ? (
							<>
								<h4>{t('calendarSync.settings')}</h4>
								<SettingsForm
									config={c()}
									onSaved={(saved: CalendarSyncConfigJson): void => {
										mutate(saved)
										setEditing(false)
									}}
									onCancel={(): void => {
										setEditing(false)
									}}
								/>
								<InlineError message={error()} />
							</>
						) : undefined
					}
					details={
						c().configured || error() !== null ? (
							<>
								<Show when={c().configured}>
									<SyncDetails
										config={c()}
										status={status(c())}
										lastRun={runs()?.[0] ?? null}
									/>
								</Show>
								<InlineError message={error()} />
							</>
						) : undefined
					}
					menu={
						<Show when={c().configured}>
							<SyncMenu onEdit={() => setEditing(true)} />
						</Show>
					}
					link={
						<Show when={c().configured}>
							<a href="/integrations/calendar-sync">
								{t('calendarSync.openTechnicians')}
							</a>
						</Show>
					}
					action={
						<Show
							when={c().configured}
							fallback={
								<button type="button" onClick={() => setEditing(true)}>
									<IconLabel icon={IconPlus}>{t('integration.setUp')}</IconLabel>
								</button>
							}
						>
							<button
								type="button"
								disabled={!canSync()}
								onClick={() => void handleSync()}
							>
								<IconLabel icon={IconRefresh}>
									{syncing()
										? t('integration.syncing')
										: t('integration.syncNow')}
								</IconLabel>
							</button>
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
						<button type="button" disabled>
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
