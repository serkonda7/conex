/**
 * Building blocks of the integration detail pages: the header with status,
 * the Enabled switch, "Sync now" and the ⋯ menu for rarer actions (Force full
 * sync), the tab bar (the integration's data first, Settings last; before
 * setup Settings is the only tab), and the danger zone at the end of the
 * Settings tab (design decision 0006). The TANSS page and the calendar sync page share
 * them, so every integration reads and behaves the same.
 */
import { IconRefresh } from '@tabler/icons-solidjs'
import { type Component, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { IconLabel } from '../../components/icon_label'
import { RowMenu, type RowMenuAction, useRowMenu } from '../../components/list_page'
import { MoreActionsButton } from '../../components/more_actions_button'
import { t } from '../../i18n'
import {
	type IntegrationStatus,
	LastRunError,
	LastRunTime,
	type RunSummary,
	StatusPill,
	WarningPill,
} from './integration_card'

/** Settings link of an integration's detail page (card menu, "Fix connection"). */
export function settingsHref(detailHref: string): string {
	return `${detailHref}?view=settings`
}

/**
 * Detail page header: icon tile, name and description; once set up, the
 * status pills and last sync on the left, the Enabled switch, "Sync now" and
 * the ⋯ menu on the right. A failing login or sync shows its message once,
 * under the last sync time.
 */
export function IntegrationDetailHeader(props: {
	name: string
	description: string
	icon: Component<{ size?: number }>
	/** False before setup: no status, switch, sync or menu. */
	configured: boolean
	status: IntegrationStatus
	/** Latest run failed while the connection itself works. */
	lastSyncFailed: boolean
	lastRun: RunSummary | null
	/** Login / sign-in error of the stored credentials. */
	connectionError: string | null
	/** Shows the Enabled switch (`integrations.manage`). */
	manageable: boolean
	/** Shows "Sync now" (`integrations.write`). */
	syncable: boolean
	enabled: boolean
	toggling: boolean
	onToggle: (enabled: boolean) => void
	syncing: boolean
	onSync: () => void
	/** Rarer actions behind ⋯ (e.g. "Force full sync"). */
	menuActions: RowMenuAction[]
}): JSX.Element {
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()
	return (
		<div class="integration-detail-header">
			<span class="integration-logo integration-detail-logo" aria-hidden="true">
				<Dynamic component={props.icon} size={22} />
			</span>
			<div class="integration-detail-title">
				<h2>{props.name}</h2>
				<p>{props.description}</p>
				<Show when={props.configured}>
					<div class="integration-detail-status">
						<div class="integration-status">
							<StatusPill status={props.status} />
							<Show when={props.enabled && props.lastSyncFailed}>
								<WarningPill>{t('integration.lastSyncFailed')}</WarningPill>
							</Show>
						</div>
						<p class="integration-meta">
							<LastRunTime run={props.lastRun} />
						</p>
						<Show when={props.enabled && props.connectionError}>
							<p class="integration-error">{props.connectionError}</p>
						</Show>
						<LastRunError
							run={props.lastRun}
							shown={props.enabled ? props.connectionError : null}
						/>
					</div>
				</Show>
			</div>
			<Show when={props.configured && (props.manageable || props.syncable)}>
				<div class="integration-detail-actions">
					<Show when={props.manageable}>
						<label class="field-toggle integration-detail-switch">
							<input
								type="checkbox"
								role="switch"
								class="toggle"
								aria-checked={props.enabled}
								checked={props.enabled}
								disabled={props.toggling}
								onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
									props.onToggle(e.currentTarget.checked)
								}
							/>
							<span>
								{props.enabled
									? t('integration.enabled')
									: t('integration.disabled')}
							</span>
						</label>
					</Show>
					<Show when={props.syncable}>
						<button
							type="button"
							disabled={!props.enabled || props.syncing}
							onClick={() => props.onSync()}
						>
							<IconLabel icon={IconRefresh}>
								{props.syncing
									? t('integration.syncing')
									: t('integration.syncNow')}
							</IconLabel>
						</button>
					</Show>
					<Show when={props.menuActions.length > 0}>
						<MoreActionsButton
							name={props.name}
							open={openMenu() !== null}
							onToggle={(e: MouseEvent & { currentTarget: HTMLButtonElement }) =>
								toggleMenu(e, 'integration', props.name)
							}
							onClose={closeMenu}
						/>
						<RowMenu
							menu={openMenu}
							onClose={closeMenu}
							cloneHref={() => undefined}
							actions={() => props.menuActions}
							deletable={() => false}
							onDelete={() => undefined}
						/>
					</Show>
				</div>
			</Show>
		</div>
	)
}

/** One tab of {@link DetailTabs}. */
export interface DetailTab<K extends string> {
	key: K
	label: string
}

/** Tab bar of an integration detail page; the caller renders the active panel. */
export function DetailTabs<K extends string>(props: {
	label: string
	tabs: DetailTab<K>[]
	active: K
	onSelect: (key: K) => void
}): JSX.Element {
	return (
		<div
			class="related-tabs-bar integration-detail-tabs"
			role="tablist"
			aria-label={props.label}
		>
			<For each={props.tabs}>
				{(tab: DetailTab<K>): JSX.Element => (
					<button
						type="button"
						role="tab"
						aria-selected={props.active === tab.key}
						onClick={() => props.onSelect(tab.key)}
					>
						{tab.label}
					</button>
				)}
			</For>
		</div>
	)
}

/** Titled settings block (Connection, Schedule, …) of the Settings tab. */
export function SettingsSection(props: {
	title: string
	description?: string
	children: JSX.Element
}): JSX.Element {
	return (
		<section class="card integration-settings-section" aria-label={props.title}>
			<h3>{props.title}</h3>
			<Show when={props.description}>
				<p class="field-hint">{props.description}</p>
			</Show>
			{props.children}
		</section>
	)
}

/**
 * Last block of the Settings tab: removing the integration. Disabling is the
 * everyday off switch; this is for good.
 */
export function DangerZone(props: {
	name: string
	pending: boolean
	onRemove: () => void
}): JSX.Element {
	return (
		<section class="card integration-danger-zone" aria-label={t('integration.dangerZone')}>
			<h3>{t('integration.removeTitle', { name: props.name })}</h3>
			<button
				type="button"
				class="btn-danger"
				disabled={props.pending}
				onClick={() => props.onRemove()}
			>
				{t('integration.remove')}
			</button>
		</section>
	)
}
