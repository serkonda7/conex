/**
 * Building blocks of the integration detail pages (design decision 0006):
 * the header with status, the Enabled switch, "Sync now" and the ⋯ menu, the
 * tab bar, and the danger zone at the end of the Settings tab. The TANSS page
 * and the calendar sync page share them, so every integration reads and
 * behaves the same.
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
	LastRunLine,
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
 * the ⋯ menu on the right. A failing login shows its message under the
 * header with a way to the settings.
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
	/** Shows the switch, "Sync now" and the menu (`integrations.manage`). */
	manageable: boolean
	enabled: boolean
	toggling: boolean
	onToggle: (enabled: boolean) => void
	syncing: boolean
	onSync: () => void
	/** Rarer actions behind ⋯ (e.g. "Force full sync"). */
	menuActions: RowMenuAction[]
	onOpenSettings: () => void
}): JSX.Element {
	const { openMenu, closeMenu, toggleMenu } = useRowMenu()
	return (
		<>
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
							<LastRunLine run={props.lastRun} />
						</div>
					</Show>
				</div>
				<Show when={props.configured && props.manageable}>
					<div class="integration-detail-actions">
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
			<Show when={props.configured && props.enabled && props.connectionError}>
				<div class="integration-detail-alert" role="alert">
					<div>
						<strong>{t('integration.status.error')}</strong>
						<p class="integration-error">{props.connectionError}</p>
					</div>
					<Show when={props.manageable}>
						<button type="button" onClick={() => props.onOpenSettings()}>
							{t('integration.openSettings')}
						</button>
					</Show>
				</div>
			</Show>
		</>
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
 * Last block of the Settings tab: removing the integration, with what it
 * deletes. Disabling is the everyday off switch; this is for good.
 */
export function DangerZone(props: {
	name: string
	/** What removing deletes and what stays. */
	text: string
	pending: boolean
	onRemove: () => void
}): JSX.Element {
	return (
		<section class="card integration-danger-zone" aria-label={t('integration.dangerZone')}>
			<div>
				<h3>{t('integration.removeTitle', { name: props.name })}</h3>
				<p>{props.text}</p>
			</div>
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
