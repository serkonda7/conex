/**
 * In-app tab strip: each entry keeps its page mounted in the background so
 * opening an add/edit form never discards the list/detail behind it. When
 * the tabs no longer fit, a dropdown at the end lists all of them.
 */
import { IconChevronDown, IconX } from '@tabler/icons-solidjs'
import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { t } from '../i18n'
import {
	activateTab,
	activeTabId,
	closeOtherTabs,
	closeTab,
	closeTabsToRight,
	duplicateTab,
	type TabState,
	tabs,
} from '../lib/router'
import { matchRoute, routeCrumbs, routeSection, type Section, tabTitle } from './routes'

interface MenuAnchor {
	tabId: number
	x: number
	y: number
}

/** Rough width of the context menu (14rem), to keep it inside the viewport. */
const MENU_WIDTH = 240

/** Tab tooltip: the page's full breadcrumb trail, else its title. */
function tabTooltip(tab: TabState): string {
	const match = matchRoute(tab.path, true)
	const crumbs = match ? routeCrumbs(tab.path, match) : []
	return crumbs.length > 0 ? crumbs.map((c) => c.label).join(' › ') : tabTitle(tab.path)
}

/** Icon of the tab's section from the route table, if it has one. */
function TabIcon(props: { path: string }): JSX.Element {
	return (
		<Show when={routeSection(props.path)?.icon}>
			{(icon: () => NonNullable<Section['icon']>) => (
				<span aria-hidden="true" class="tab-icon">
					<Dynamic component={icon()} size={14} />
				</span>
			)}
		</Show>
	)
}

function MenuItem(props: {
	label: string
	active?: boolean
	title?: string
	onClick: () => void
	children?: JSX.Element
}): JSX.Element {
	return (
		<button
			type="button"
			role="menuitem"
			class={props.active === true ? 'tab-menu-item active' : 'tab-menu-item'}
			title={props.title}
			onClick={() => props.onClick()}
		>
			{props.children ?? props.label}
		</button>
	)
}

/** Right-click menu of one tab. */
function TabMenu(props: { anchor: MenuAnchor; onClose: () => void }): JSX.Element {
	const index = (): number => tabs().findIndex((tab) => tab.id === props.anchor.tabId)
	function run(action: (id: number) => void): void {
		action(props.anchor.tabId)
		props.onClose()
	}
	return (
		<div
			class="tab-menu tab-context-menu"
			role="menu"
			style={{ left: `${props.anchor.x}px`, top: `${props.anchor.y}px` }}
		>
			<MenuItem label={t('tab.duplicate')} onClick={() => run(duplicateTab)} />
			<Show when={tabs().length > 1}>
				<MenuItem label={t('common.close')} onClick={() => run(closeTab)} />
				<MenuItem label={t('tab.closeOthers')} onClick={() => run(closeOtherTabs)} />
			</Show>
			<Show when={index() < tabs().length - 1}>
				<MenuItem label={t('tab.closeToRight')} onClick={() => run(closeTabsToRight)} />
			</Show>
		</div>
	)
}

/** One tab button: activate, middle-click to close, right-click for the menu. */
function TabItem(props: { tab: TabState; onMenu: (anchor: MenuAnchor) => void }): JSX.Element {
	const title = (): string => tabTitle(props.tab.path)
	const active = (): boolean => props.tab.id === activeTabId()
	return (
		<div
			role="tab"
			data-tab-button={props.tab.id}
			aria-selected={active()}
			aria-label={title()}
			title={tabTooltip(props.tab)}
			tabIndex={0}
			class={active() ? 'tab-item active' : 'tab-item'}
			onClick={() => activateTab(props.tab.id)}
			onKeyDown={(e: KeyboardEvent): void => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault()
					activateTab(props.tab.id)
				}
			}}
			onAuxClick={(e: MouseEvent): void => {
				if (e.button === 1) {
					e.preventDefault()
					closeTab(props.tab.id)
				}
			}}
			onContextMenu={(e: MouseEvent): void => {
				e.preventDefault()
				const x = Math.min(e.clientX, window.innerWidth - MENU_WIDTH)
				props.onMenu({ tabId: props.tab.id, x: Math.max(0, x), y: e.clientY })
			}}
		>
			<TabIcon path={props.tab.path} />
			<span class="tab-title">{title()}</span>
			<Show when={tabs().length > 1}>
				<button
					type="button"
					class="tab-close"
					aria-label={t('app.closeTab', { title: title() })}
					title={t('app.closeTab', { title: title() })}
					onClick={(e: MouseEvent): void => {
						e.stopPropagation()
						closeTab(props.tab.id)
					}}
				>
					<span aria-hidden="true" class="tab-close-icon">
						<IconX size={12} />
					</span>
				</button>
			</Show>
		</div>
	)
}

/** Dropdown at the end of an overflowing strip, listing every tab. */
function TabList(props: { open: boolean; onToggle: () => void; onPick: () => void }): JSX.Element {
	return (
		<div class="tab-list">
			<button
				type="button"
				class="tab-list-toggle"
				aria-haspopup="menu"
				aria-expanded={props.open}
				aria-label={t('app.allTabs')}
				title={t('app.allTabs')}
				onClick={() => props.onToggle()}
			>
				<span aria-hidden="true" class="tab-close-icon">
					<IconChevronDown size={14} />
				</span>
			</button>
			<Show when={props.open}>
				<div class="tab-menu tab-list-menu" role="menu">
					<For each={tabs()}>
						{(tab: TabState) => (
							<MenuItem
								label={tabTitle(tab.path)}
								active={tab.id === activeTabId()}
								title={tabTooltip(tab)}
								onClick={() => {
									props.onPick()
									activateTab(tab.id)
								}}
							>
								<TabIcon path={tab.path} />
								<span class="tab-title">{tabTitle(tab.path)}</span>
							</MenuItem>
						)}
					</For>
				</div>
			</Show>
		</div>
	)
}

export function TabBar(): JSX.Element {
	const [menu, setMenu] = createSignal<MenuAnchor | null>(null)
	const [listOpen, setListOpen] = createSignal(false)
	const [overflowing, setOverflowing] = createSignal(false)
	let strip: HTMLDivElement | undefined

	function measure(): void {
		if (strip) {
			setOverflowing(strip.scrollWidth > strip.clientWidth)
		}
	}

	function closeMenus(): void {
		setMenu(null)
		setListOpen(false)
	}

	onMount(() => {
		const observer = new ResizeObserver(measure)
		if (strip) {
			observer.observe(strip)
		}
		const onPointerDown = (e: PointerEvent): void => {
			if (
				e.target instanceof Element &&
				e.target.closest('.tab-menu, .tab-list-toggle') === null
			) {
				closeMenus()
			}
		}
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				closeMenus()
			}
		}
		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('keydown', onKeyDown)
		onCleanup(() => {
			observer.disconnect()
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('keydown', onKeyDown)
		})
	})

	// Titles change as pages load, so re-measure whenever they do, and keep
	// the active tab scrolled into view.
	createEffect(() => {
		for (const tab of tabs()) {
			tabTitle(tab.path)
		}
		const id = activeTabId()
		requestAnimationFrame(() => {
			measure()
			strip
				?.querySelector(`[data-tab-button="${id}"]`)
				?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		})
	})

	return (
		<div class="tab-bar-wrap">
			<div class="tab-bar" role="tablist" aria-label={t('app.openPages')} ref={strip}>
				<For each={tabs()}>
					{(tab: TabState) => (
						<TabItem
							tab={tab}
							onMenu={(anchor: MenuAnchor) => {
								setListOpen(false)
								setMenu(anchor)
							}}
						/>
					)}
				</For>
			</div>
			<Show when={overflowing()}>
				<TabList
					open={listOpen()}
					onToggle={() => {
						setMenu(null)
						setListOpen(!listOpen())
					}}
					onPick={() => setListOpen(false)}
				/>
			</Show>
			<Show when={menu()}>
				{(anchor: () => MenuAnchor) => (
					<TabMenu anchor={anchor()} onClose={() => setMenu(null)} />
				)}
			</Show>
		</div>
	)
}
