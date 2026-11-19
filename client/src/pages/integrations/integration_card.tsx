/**
 * One integration on /integrations, top to bottom: icon tile, name and a
 * few-word description; one state pill (Connected, Syncing…, Connection
 * failed, Disabled) plus yellow warning pills for problems that keep the
 * connection working, followed in the same row by when it last synced
 * (relative, exact time on hover) and the action (a sync icon, "Set up");
 * then the server's error and a link only when something needs fixing.
 *
 * The whole card opens the integration's detail page (the name is the link,
 * stretched over the card; buttons and links stay on top). A failing card gets
 * an error-tinted border, a disabled one is dimmed, and one with a missing
 * prerequisite stays visible and says what it needs. The green primary style
 * is kept for the one action that matters most (e.g. "Run first sync"). The
 * list layout lays the same parts out as one row per integration.
 */

import { IconRefresh } from '@tabler/icons-solidjs'
import { type Accessor, type Component, createSignal, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { t } from '../../i18n'
import { formatRelative, formatTime } from '../../lib/time'

export type IntegrationLayout = 'grid' | 'list'

const LAYOUT_KEY = 'conex:integrations-layout'

function loadLayout(): IntegrationLayout {
	try {
		return window.localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'
	} catch {
		return 'grid'
	}
}

const [layout, setLayoutSignal] = createSignal<IntegrationLayout>(loadLayout())

/** Grid or list layout of the integrations page, persisted per browser. */
export const integrationLayout: Accessor<IntegrationLayout> = layout

export function setIntegrationLayout(next: IntegrationLayout): void {
	setLayoutSignal(next)
	try {
		window.localStorage.setItem(LAYOUT_KEY, next)
	} catch {
		// Storage unavailable (private mode): the layout still applies for the session.
	}
}

export type IntegrationStatus = 'connected' | 'running' | 'error' | 'disabled'

const STATUS_BADGES: Record<IntegrationStatus, string> = {
	connected: 'badge badge-connected',
	running: 'badge badge-planned',
	error: 'badge badge-inactive',
	disabled: 'badge',
}

/** Connection state pill; a running sync pulses. */
export function StatusPill(props: { status: IntegrationStatus }): JSX.Element {
	const label = (): string => {
		switch (props.status) {
			case 'connected':
				return t('integration.status.connected')
			case 'running':
				return t('integration.syncing')
			case 'error':
				return t('integration.status.error')
			case 'disabled':
				return t('integration.disabled')
		}
	}
	return (
		<span class={STATUS_BADGES[props.status]}>
			<span
				aria-hidden="true"
				class="badge-dot"
				classList={{ 'badge-dot-pulse': props.status === 'running' }}
			/>
			{label()}
		</span>
	)
}

/** Yellow pill for a problem that does not break the connection. */
export function WarningPill(props: { children: JSX.Element }): JSX.Element {
	return <span class="badge badge-warning">{props.children}</span>
}

/** The fields of a TANSS or calendar sync run the cards show. */
export interface RunSummary {
	state: string
	started_at: number
	finished_at: number | null
	error: string | null
}

/** When the latest sync ran (relative, exact time on hover), inline. */
export function LastRunTime(props: { run: RunSummary | null }): JSX.Element {
	return (
		<Show
			when={props.run}
			fallback={<span class="integration-meta">{t('integration.neverSynced')}</span>}
		>
			{(run: () => RunSummary): JSX.Element => {
				const at = (): number => run().finished_at ?? run().started_at
				return (
					<span class="integration-meta" title={formatTime(at())}>
						{run().state === 'running'
							? t('integration.syncStarted', { time: formatRelative(at()) })
							: t('integration.lastSyncAt', { time: formatRelative(at()) })}
					</span>
				)
			}}
		</Show>
	)
}

/** The error of the latest sync, when it failed. */
export function LastRunError(props: { run: RunSummary | null }): JSX.Element {
	return (
		<Show when={props.run?.state === 'error' && props.run.error}>
			<p class="integration-error">{props.run?.error}</p>
		</Show>
	)
}

/**
 * When the latest sync ran (relative, exact time on hover). A failed run
 * adds its error on a second line.
 */
export function LastRunLine(props: { run: RunSummary | null }): JSX.Element {
	return (
		<>
			<p class="integration-meta">
				<LastRunTime run={props.run} />
			</p>
			<LastRunError run={props.run} />
		</>
	)
}

/** Icon-only "Sync now" next to the last sync time; spins while syncing. */
export function SyncIconButton(props: {
	syncing: boolean
	disabled: boolean
	onClick: () => void
}): JSX.Element {
	const label = (): string =>
		props.syncing ? t('integration.syncing') : t('integration.syncNow')
	return (
		<button
			type="button"
			class="icon-btn integration-sync-btn"
			classList={{ 'integration-sync-btn-spin': props.syncing }}
			aria-label={label()}
			title={label()}
			disabled={props.disabled || props.syncing}
			onClick={() => props.onClick()}
		>
			<IconRefresh size={14} />
		</button>
	)
}

export function IntegrationCard(props: {
	name: string
	description: string
	icon: Component<{ size?: number }>
	/** Detail page the card opens; omitted while it cannot be opened. */
	href?: string
	/** Status pills and last sync time; omitted while the integration is not set up. */
	status?: JSX.Element
	/** Lines below the status row: errors, prerequisites. */
	details?: JSX.Element
	/** Below the details: a link that needs attention (e.g. "Fix connection →"). */
	link?: JSX.Element
	/** The one action: at the end of the status row, or last without one. */
	action?: JSX.Element
	tone?: 'error' | 'disabled'
}): JSX.Element {
	return (
		<section
			class="integration-card"
			classList={{
				'integration-card-error': props.tone === 'error',
				'integration-card-disabled': props.tone === 'disabled',
				'integration-card-linked': props.href !== undefined,
			}}
			aria-label={props.name}
		>
			<div class="integration-card-head">
				<span class="integration-logo" aria-hidden="true">
					<Dynamic component={props.icon} size={18} />
				</span>
				<div class="integration-card-title">
					<h4>
						<Show when={props.href} fallback={props.name}>
							{(href: () => string): JSX.Element => (
								<a class="integration-card-link" href={href()}>
									{props.name}
								</a>
							)}
						</Show>
					</h4>
					<p>{props.description}</p>
				</div>
			</div>
			<div class="integration-card-body">
				<Show when={props.status}>
					<div class="integration-status">
						{props.status}
						{props.action}
					</div>
				</Show>
				{props.details}
				<span class="integration-card-fix">{props.link}</span>
				<Show when={!props.status}>
					<span class="integration-card-action">{props.action}</span>
				</Show>
			</div>
		</section>
	)
}
