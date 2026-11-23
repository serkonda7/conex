/**
 * Command palette (Ctrl+K / ⌘K, or the top-bar search button): one input
 * that jumps to pages, add/import forms and inventory objects. Pages and
 * actions are matched client-side from the route table; objects come from
 * the server's global search, debounced while typing.
 */
import { IconDownload, IconPlus, IconSearch } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	For,
	type JSX,
	on,
	onCleanup,
	onMount,
	Show,
} from 'solid-js'
import { type GlobalSearchResponse, search_objects } from '../api/search'
import { type PluralKey, t, tp } from '../i18n'
import { goTo, navigate, opensInNewTab } from '../lib/router'
import { can } from '../lib/session'
import { canAddInSection, canOpenSection, routeSection, SECTIONS, type Section } from './routes'

/** Delay after the last keystroke before the server is searched. */
const SEARCH_DELAY_MS = 150

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Label of the shortcut's modifier key. */
function modifierKey(): string {
	return IS_MAC ? '⌘' : t('palette.ctrl')
}

interface PaletteItem {
	key: string
	label: string
	/** Secondary text right of the label (e.g. a device's asset tag). */
	detail?: string
	/** Owning tenant of an object hit, at the right end. */
	tenant?: string
	href: string
	icon?: Component<{ size?: number }>
	/** Extra words the item matches without showing them (`+` for add forms). */
	keywords?: string
	/** Server hit for an object: a plain click follows the new-tab preference. */
	isItem?: boolean
}

interface PaletteGroup {
	key: string
	label: string
	items: PaletteItem[]
}

/** A group's items with their position in the flat keyboard order. */
interface IndexedGroup extends PaletteGroup {
	items: (PaletteItem & { index: number })[]
}

/** Section icon, falling back to the parent section's (VMs use the devices icon). */
function sectionIcon(section: Section | null): Section['icon'] {
	return section?.icon ?? SECTIONS.find((s) => s.path === section?.parent)?.icon
}

/** Lower-cased query words; `+` counts as a word of its own (`+device`). */
function queryWords(query: string): string[] {
	return query
		.toLocaleLowerCase()
		.replaceAll('+', ' + ')
		.split(/\s+/)
		.filter((word) => word !== '')
}

/** True when every query word occurs in the item's label or keywords, in any order. */
function matches(item: PaletteItem, words: readonly string[]): boolean {
	const text = `${item.label} ${item.keywords ?? ''}`.toLocaleLowerCase()
	return words.every((word) => text.includes(word))
}

/** A query starting with `+` asks for an add form, not for objects. */
function isAddQuery(query: string): boolean {
	return query.trim().startsWith('+')
}

/** Section lists the user may open, then their add/import forms. */
function commandGroups(query: string): PaletteGroup[] {
	const words = queryWords(query)
	const pages: PaletteItem[] = []
	const actions: PaletteItem[] = []
	for (const section of SECTIONS) {
		if (!canOpenSection(section)) {
			continue
		}
		const href = `/${section.path}`
		const icon = sectionIcon(section)
		if (section.list) {
			const label = section.navLabel?.() ?? section.noun(2)
			pages.push({ key: `page:${section.path}`, label, href, icon })
		}
		if (!canAddInSection(section)) {
			continue
		}
		if (section.add) {
			actions.push({
				key: `add:${section.path}`,
				label: t('tab.add', { entity: section.noun(1) }),
				href: `${href}/add`,
				icon: IconPlus,
				keywords: `+ ${section.noun(2)}`,
			})
		}
		if (section.import) {
			actions.push({
				key: `import:${section.path}`,
				label: t('tab.import', { entities: section.noun(2) }),
				href: `${href}/import`,
				icon: IconDownload,
			})
		}
	}
	const groups: PaletteGroup[] = [
		{
			key: 'pages',
			label: t('palette.pages'),
			items: pages.filter((i) => matches(i, words)),
		},
	]
	// Without a query the actions would only bury the pages.
	if (words.length > 0) {
		groups.push({
			key: 'actions',
			label: t('palette.actions'),
			items: actions.filter((i) => matches(i, words)),
		})
	}
	return groups
}

/** Server hits grouped by entity, linking to their detail pages. */
function resultGroups(res: GlobalSearchResponse): PaletteGroup[] {
	const group = (
		key: string,
		noun: PluralKey,
		base: string,
		/** `tenant_name`: null for shared rows, absent for tenants themselves. */
		rows: { id: number; name: string; detail?: string | null; tenant_name?: string | null }[],
	): PaletteGroup => {
		const icon = sectionIcon(routeSection(base))
		return {
			key,
			label: tp(noun, 2),
			items: rows.map((row) => ({
				key: `${key}:${row.id}`,
				label: row.name,
				detail: row.detail ?? undefined,
				tenant:
					row.tenant_name === undefined
						? undefined
						: (row.tenant_name ?? t('common.noTenant')),
				href: `${base}/${row.id}`,
				icon,
				isItem: true,
			})),
		}
	}
	return [
		group(
			'devices',
			'entity.device',
			'/devices',
			res.devices.items.map((d) => ({ ...d, detail: d.asset_tag })),
		),
		group('vms', 'entity.virtualMachine', '/devices/vm', res.virtual_machines.items),
		group('racks', 'entity.rack', '/racks', res.racks.items),
		group('sites', 'entity.site', '/sites', res.sites.items),
		group('tenants', 'entity.tenant', '/tenants', res.tenants.items),
	]
}

/** Top-bar button opening the palette; shows the shortcut on wide screens. */
export function CommandPaletteButton(props: { onOpen: () => void }): JSX.Element {
	return (
		<button
			type="button"
			class="app-search-trigger"
			aria-haspopup="dialog"
			aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}
			title={t('palette.title')}
			onClick={() => props.onOpen()}
		>
			<span aria-hidden="true" class="app-nav-icon">
				<IconSearch size={16} />
			</span>
			<span class="app-search-trigger-label">{t('palette.trigger')}</span>
			<kbd class="app-search-trigger-key">{modifierKey()} K</kbd>
		</button>
	)
}

/**
 * The palette dialog. `open` is owned by the caller so the top-bar button
 * can open it; Ctrl+K / ⌘K toggles it from anywhere in the workspace.
 */
export function CommandPalette(props: {
	open: boolean
	setOpen: (open: boolean) => void
}): JSX.Element {
	const listId = createUniqueId()
	const [query, setQuery] = createSignal('')
	const [active, setActive] = createSignal(0)
	const [results, setResults] = createSignal<GlobalSearchResponse | null>(null)
	const [searching, setSearching] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	let dialog: HTMLDialogElement | undefined
	let input: HTMLInputElement | undefined
	let list: HTMLDivElement | undefined

	onMount(() => {
		const onShortcut = (e: KeyboardEvent): void => {
			if (
				(e.ctrlKey || e.metaKey) &&
				!e.altKey &&
				!e.shiftKey &&
				e.key.toLowerCase() === 'k'
			) {
				// Also keeps the browser from focusing its own search bar.
				e.preventDefault()
				props.setOpen(!props.open)
			}
		}
		window.addEventListener('keydown', onShortcut)
		onCleanup(() => window.removeEventListener('keydown', onShortcut))
	})

	createEffect(() => {
		if (props.open) {
			setQuery('')
			setActive(0)
			if (!dialog?.open) {
				dialog?.showModal()
			}
			input?.focus()
			const previousOverflow = document.body.style.overflow
			document.body.style.overflow = 'hidden'
			onCleanup(() => {
				document.body.style.overflow = previousOverflow
			})
		} else {
			dialog?.close()
		}
	})

	// Debounced server search; a response for an outdated query is dropped.
	let timer: ReturnType<typeof setTimeout> | undefined
	let requestSeq = 0
	createEffect(
		on(query, (q: string) => {
			clearTimeout(timer)
			const seq = ++requestSeq
			const trimmed = q.trim()
			if (trimmed === '' || isAddQuery(trimmed) || !can('view')) {
				setResults(null)
				setError(null)
				setSearching(false)
				return
			}
			setSearching(true)
			timer = setTimeout(async () => {
				const res = await search_objects(trimmed)
				if (seq !== requestSeq) {
					return
				}
				setSearching(false)
				if (Result.isError(res)) {
					setResults(null)
					setError(res.error.message)
				} else {
					setResults(res.value)
					setError(null)
				}
			}, SEARCH_DELAY_MS)
		}),
	)
	onCleanup(() => clearTimeout(timer))

	const groups = createMemo((): IndexedGroup[] => {
		const res = results()
		const all = [...commandGroups(query()), ...(res ? resultGroups(res) : [])]
		let index = 0
		return all
			.filter((group) => group.items.length > 0)
			.map((group) => ({
				...group,
				items: group.items.map((item) => ({ ...item, index: index++ })),
			}))
	})
	const items = createMemo(() => groups().flatMap((group) => group.items))

	// Back to the top whenever the hits change.
	createEffect(on(items, () => setActive(0)))
	createEffect(() => {
		active()
		list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
	})

	function close(): void {
		props.setOpen(false)
	}

	function open(item: PaletteItem, newTab: boolean): void {
		close()
		// Commands (add, go to a section) stay in this tab; object hits follow
		// the same preference as a plain click on their detail link.
		const useNewTab = newTab || (item.isItem === true && opensInNewTab(item.href))
		navigate(item.href, { newTab: useNewTab })
	}

	function onKeyDown(e: KeyboardEvent): void {
		const count = items().length
		if (e.isComposing) {
			return
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setActive(count === 0 ? 0 : (active() + 1) % count)
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setActive(count === 0 ? 0 : (active() - 1 + count) % count)
		} else if (e.key === 'Enter') {
			e.preventDefault()
			const item = items()[active()]
			if (item) {
				open(item, e.ctrlKey || e.metaKey || e.shiftKey)
			}
		}
	}

	const trimmedQuery = (): string => query().trim()
	const showEmpty = (): boolean =>
		trimmedQuery() !== '' && !searching() && error() === null && items().length === 0

	return (
		<dialog
			ref={dialog}
			class="command-palette"
			aria-label={t('palette.title')}
			// Escape: the native cancel closes the dialog; keep `open` in sync.
			onClose={close}
			onPointerDown={(e: PointerEvent): void => {
				if (e.target === e.currentTarget) {
					close()
				}
			}}
		>
			<div class="command-palette-box">
				<div class="command-palette-input-row">
					<span aria-hidden="true" class="app-nav-icon">
						<IconSearch size={18} />
					</span>
					<input
						ref={input}
						type="text"
						class="command-palette-input"
						placeholder={t('palette.placeholder')}
						aria-label={t('palette.placeholder')}
						role="combobox"
						aria-expanded="true"
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={
							items()[active()] ? `${listId}-${active()}` : undefined
						}
						autocomplete="off"
						spellcheck={false}
						value={query()}
						onInput={(e: InputEventAndTarget) => setQuery(e.currentTarget.value)}
						onKeyDown={onKeyDown}
					/>
				</div>
				<div
					ref={list}
					class="command-palette-options"
					role="listbox"
					id={listId}
					aria-label={t('palette.title')}
				>
					<For each={groups()}>
						{(group: IndexedGroup): JSX.Element => (
							<div>
								<div class="command-palette-group" aria-hidden="true">
									{group.label}
								</div>
								<For each={group.items}>
									{(item: PaletteItem & { index: number }): JSX.Element => (
										<a
											href={item.href}
											id={`${listId}-${item.index}`}
											role="option"
											tabIndex={-1}
											aria-selected={item.index === active()}
											classList={{
												'command-palette-option': true,
												active: item.index === active(),
											}}
											onPointerMove={() => setActive(item.index)}
											// pointerdown keeps focus in the input.
											onPointerDown={(e: PointerEvent) => e.preventDefault()}
											onClick={(e: MouseEvent): void => {
												close()
												goTo(e, item.href)
											}}
										>
											<span aria-hidden="true" class="command-palette-icon">
												<Show when={item.icon}>
													{(
														icon: () => NonNullable<
															PaletteItem['icon']
														>,
													) => {
														const Icon = icon()
														return <Icon size={16} />
													}}
												</Show>
											</span>
											<span class="command-palette-label">{item.label}</span>
											<Show when={item.detail}>
												<span class="command-palette-detail">
													{item.detail}
												</span>
											</Show>
											<Show when={item.tenant}>
												<span class="command-palette-tenant">
													{item.tenant}
												</span>
											</Show>
										</a>
									)}
								</For>
							</div>
						)}
					</For>
				</div>
				<Show when={error()}>
					{(message: () => string) => (
						<p class="command-palette-status error" role="alert">
							{message()}
						</p>
					)}
				</Show>
				<Show when={searching() && items().length === 0}>
					<p class="command-palette-status">{t('palette.searching')}</p>
				</Show>
				<Show when={showEmpty()}>
					<p class="command-palette-status">
						{t('palette.noMatch', { search: trimmedQuery() })}
					</p>
				</Show>
				<div class="command-palette-hints" aria-hidden="true">
					<span>
						<kbd>↑</kbd>
						<kbd>↓</kbd> {t('palette.hintNavigate')}
					</span>
					<span>
						<kbd>↵</kbd> {t('palette.hintOpen')}
					</span>
					<span>
						<kbd>{modifierKey()}</kbd>
						<kbd>↵</kbd> {t('palette.hintNewTab')}
					</span>
				</div>
			</div>
		</dialog>
	)
}
