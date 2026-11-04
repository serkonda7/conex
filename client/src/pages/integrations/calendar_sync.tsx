/**
 * Calendar sync card on the integrations page (TANSS appointments →
 * Outlook), laid out like the provider cards: "Sync now" / "Edit" in the
 * header and a summary of the Microsoft 365 app, which "Edit" swaps for the
 * settings form with its connection test, and the recent runs. The
 * technician → mailbox mappings live on their own page
 * (/integrations/calendar-sync), linked from the card like the TANSS
 * consistency report. Global `integrations.manage` only, like the routes.
 */
import { IconPencil, IconRefresh } from '@tabler/icons-solidjs'
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
import { CheckboxField, Field, Hint, TextField } from '../../components/form'
import { IconLabel } from '../../components/icon_label'
import { t } from '../../i18n'
import { syncStateLabel } from '../../i18n/labels'
import { createRecord, createRows, createRowsFor, useAction } from '../../lib/resource'
import { usePageMeta } from '../../lib/router'
import { formatTime } from '../../lib/time'

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
	const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null)
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
			<CheckboxField
				id="calendar-sync-enabled"
				label={t('calendarSync.enabled')}
				checked={enabled()}
				onChange={setEnabled}
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
				<Show when={testResult()}>
					{(result: () => { ok: boolean; message: string }) => (
						<p
							class={result().ok ? 'text-success' : 'text-danger'}
							role={result().ok ? 'status' : 'alert'}
						>
							{result().message}
						</p>
					)}
				</Show>
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

/** Recent runs, newest first. */
function RunsTable(props: { runs: CalendarSyncRunJson[] }): JSX.Element {
	return (
		<Show when={props.runs.length > 0} fallback={<Empty message={t('calendarSync.noRuns')} />}>
			<table>
				<thead>
					<tr>
						<th>{t('calendarSync.startedAt')}</th>
						<th>{t('common.status')}</th>
						<th>{t('calendarSync.changes')}</th>
						<th>{t('calendarSync.error')}</th>
					</tr>
				</thead>
				<tbody>
					<For each={props.runs}>
						{(run: CalendarSyncRunJson): JSX.Element => (
							<tr>
								<td>{formatTime(run.started_at)}</td>
								<td>{syncStateLabel(run.state)}</td>
								<td>
									<Show when={run.state !== 'running'}>
										{t('calendarSync.counts', { ...run.counts })}
									</Show>
								</td>
								<td>
									<Show when={run.error}>
										<span class="text-danger">{run.error}</span>
									</Show>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</Show>
	)
}

/**
 * Enabled state (or the last error) of the sync, and how many technicians
 * have an enabled mailbox mapping.
 */
function SyncState(props: {
	config: CalendarSyncConfigJson
	technicians: CalendarTechnicianJson[] | undefined
}): JSX.Element {
	const active = (): number =>
		(props.technicians ?? []).filter((tech) => tech.mapping?.enabled === true).length
	return (
		<>
			<div>
				<Show when={props.config.enabled} fallback={t('integration.disabled')}>
					<Show when={props.config.last_error} fallback={t('integration.enabled')}>
						<span class="text-danger">{props.config.last_error}</span>
					</Show>
				</Show>
			</div>
			<Show when={props.technicians}>
				{(techs: () => CalendarTechnicianJson[]) => (
					<div>
						{t('calendarSync.technicianCount', {
							active: active(),
							total: techs().length,
						})}
					</div>
				)}
			</Show>
		</>
	)
}

/** State, time, error and counts of the latest run. */
function LastRun(props: { run: CalendarSyncRunJson }): JSX.Element {
	return (
		<>
			<div>
				{syncStateLabel(props.run.state)}
				{' ('}
				{formatTime(props.run.finished_at ?? props.run.started_at)}
				{')'}
				<Show when={props.run.error}>
					{' · '}
					<span class="text-danger">{props.run.error}</span>
				</Show>
			</div>
			<Show when={props.run.state !== 'running'}>
				<div>{t('calendarSync.counts', { ...props.run.counts })}</div>
			</Show>
		</>
	)
}

/** Summary of the saved settings and the latest run. */
function SyncDetails(props: {
	config: CalendarSyncConfigJson
	lastRun: CalendarSyncRunJson | undefined
	technicians: CalendarTechnicianJson[] | undefined
}): JSX.Element {
	return (
		<>
			<dl class="detail-grid">
				<dt>{t('calendarSync.tenantId')}</dt>
				<dd>{props.config.ms_tenant_id}</dd>
				<dt>{t('calendarSync.clientId')}</dt>
				<dd>{props.config.client_id}</dd>
				<dt>{t('calendarSync.intervalLabel')}</dt>
				<dd>
					{t('calendarSync.everyMinutes', { minutes: props.config.interval_minutes })}
				</dd>
				<dt>{t('common.status')}</dt>
				<dd>
					<SyncState config={props.config} technicians={props.technicians} />
				</dd>
				<dt>{t('integration.lastSync')}</dt>
				<dd>
					<Show when={props.lastRun} fallback={t('integration.neverSynced')}>
						{(run: () => CalendarSyncRunJson) => <LastRun run={run()} />}
					</Show>
				</dd>
			</dl>
			<p>
				<a href="/integrations/calendar-sync">{t('calendarSync.openTechnicians')}</a>
			</p>
		</>
	)
}

export function CalendarSyncCard(): JSX.Element {
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
	// Shares the cache with the technician page, so its changes show here.
	const [technicians] = createRowsFor(
		() => config()?.configured === true,
		fetch_calendar_technicians,
		setError,
	)

	const canSync = (): boolean => {
		const c = config()
		return c?.configured === true && c.enabled && !syncing()
	}

	return (
		<section class="card" aria-label={t('calendarSync.title')}>
			<div class="page-header">
				<h3>{t('calendarSync.title')}</h3>
				<Show when={config()}>
					{(c: () => CalendarSyncConfigJson): JSX.Element => (
						<Show
							when={c().configured}
							fallback={
								<Show when={!editing()}>
									<button
										type="button"
										class="btn-add"
										onClick={(): void => {
											setEditing(true)
										}}
									>
										{t('integration.setUp')}
									</button>
								</Show>
							}
						>
							<div class="form-actions">
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
								<button
									type="button"
									disabled={editing()}
									onClick={(): void => {
										setEditing(true)
									}}
								>
									<IconLabel icon={IconPencil}>{t('common.edit')}</IconLabel>
								</button>
							</div>
						</Show>
					)}
				</Show>
			</div>
			<Show when={config()} fallback={<Loading message={t('calendarSync.loading')} />}>
				{(c: () => CalendarSyncConfigJson): JSX.Element => (
					<>
						<Show
							when={editing()}
							fallback={
								<Show
									when={c().configured}
									fallback={<Empty message={t('integration.notConfigured')} />}
								>
									<SyncDetails
										config={c()}
										lastRun={runs()?.[0]}
										technicians={
											technicians.loading ? undefined : technicians()
										}
									/>
								</Show>
							}
						>
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
						</Show>
					</>
				)}
			</Show>
			<InlineError message={error()} />
		</section>
	)
}
