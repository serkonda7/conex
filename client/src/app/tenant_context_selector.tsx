import { IconChevronDown, IconPlus } from '@tabler/icons-solidjs'
import type { InputEventAndTarget } from 'shared/src/types'
import {
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from 'solid-js'
import { t } from '../i18n'
import { navigate } from '../lib/router'
import {
	contextGroups,
	contextTenantRows,
	refreshTenantContext,
	setTenantContext,
	type TenantContext,
	tenantContext,
} from '../lib/tenant_context'

/** One selectable row of the dropdown, in display order. */
interface ContextOption {
	key: string
	context: TenantContext
	label: string
	/** Tenants listed under their group are indented. */
	nested: boolean
}

function contextKey(ctx: TenantContext): string {
	return ctx.kind === 'all' ? 'all' : `${ctx.kind}:${ctx.id}`
}

function matches(text: string, query: string): boolean {
	return text.toLocaleLowerCase().includes(query)
}

/**
 * Top-bar tenant context selector: a searchable dropdown offering all
 * tenants, a whole tenant group, or a single tenant (listed under its
 * group). Users allowed to create tenants get an add button; when the
 * search matches nothing it offers to create a tenant with that name.
 * Scoped users get a fixed label with their own tenant instead.
 */
export function TenantContextSelector(props: { scoped: boolean; canAdd: boolean }): JSX.Element {
	const listId = createUniqueId()
	const [open, setOpen] = createSignal(false)
	const [query, setQuery] = createSignal('')
	const [active, setActive] = createSignal(0)
	let root: HTMLDivElement | undefined
	let input: HTMLInputElement | undefined

	const currentLabel = (): string => {
		const ctx = tenantContext()
		if (ctx.kind === 'group') {
			const name = contextGroups().find((g) => g.id === ctx.id)?.name ?? '…'
			return t('app.tenantContextGroup', { name })
		}
		if (ctx.kind === 'tenant') {
			return contextTenantRows().find((row) => row.id === ctx.id)?.name ?? '…'
		}
		return t('common.allTenants')
	}

	// Groups first (each followed by its tenants), then ungrouped tenants.
	// A matching group keeps all its tenants; a matching tenant keeps its
	// group row so the hierarchy stays readable.
	const options = createMemo((): ContextOption[] => {
		const q = query().trim().toLocaleLowerCase()
		const out: ContextOption[] = []
		if (q === '') {
			out.push({
				key: 'all',
				context: { kind: 'all' },
				label: t('common.allTenants'),
				nested: false,
			})
		}
		const tenantOption = (
			row: { id: number; name: string },
			nested: boolean,
		): ContextOption => ({
			key: `tenant:${row.id}`,
			context: { kind: 'tenant', id: row.id },
			label: row.name,
			nested,
		})
		for (const group of contextGroups()) {
			const members = contextTenantRows().filter((row) => row.tenant_group_id === group.id)
			const groupHit = q === '' || matches(group.name, q)
			const hits = groupHit ? members : members.filter((row) => matches(row.name, q))
			if (!groupHit && hits.length === 0) {
				continue
			}
			out.push({
				key: `group:${group.id}`,
				context: { kind: 'group', id: group.id },
				label: t('app.tenantContextGroup', { name: group.name }),
				nested: false,
			})
			for (const row of hits) {
				out.push(tenantOption(row, true))
			}
		}
		for (const row of contextTenantRows()) {
			if (row.tenant_group_id !== null) {
				continue
			}
			if (q === '' || matches(row.name, q)) {
				out.push(tenantOption(row, false))
			}
		}
		return out
	})

	/** True when no tenant is named exactly like the search. */
	const offerCreate = (): boolean => {
		const q = query().trim().toLocaleLowerCase()
		return q !== '' && !contextTenantRows().some((row) => row.name.toLocaleLowerCase() === q)
	}

	function openMenu(): void {
		setQuery('')
		setOpen(true)
		// Tenants/groups change on their own pages; reload on every open.
		void refreshTenantContext()
		queueMicrotask(() => input?.focus())
	}

	function close(): void {
		setOpen(false)
	}

	function choose(option: ContextOption): void {
		setTenantContext(option.context)
		close()
	}

	function addTenant(): void {
		const name = query().trim()
		close()
		navigate(
			name === ''
				? '/tenants/add?select=1'
				: `/tenants/add?select=1&name=${encodeURIComponent(name)}`,
		)
	}

	// Keep the highlighted row on the current context when opening, and in
	// range while the search narrows the list.
	createEffect(() => {
		if (!open()) {
			return
		}
		const list = options()
		const current = list.findIndex((o) => o.key === contextKey(tenantContext()))
		setActive(query() === '' && current >= 0 ? current : 0)
	})

	function onKeyDown(e: KeyboardEvent): void {
		const list = options()
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setActive(Math.min(active() + 1, list.length - 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setActive(Math.max(active() - 1, 0))
		} else if (e.key === 'Enter') {
			e.preventDefault()
			const option = list[active()]
			if (option) {
				choose(option)
			} else if (props.canAdd && offerCreate()) {
				addTenant()
			}
		} else if (e.key === 'Escape') {
			e.preventDefault()
			close()
		}
	}

	onMount(() => {
		const onPointerDown = (e: PointerEvent): void => {
			if (root && e.target instanceof Node && !root.contains(e.target)) {
				close()
			}
		}
		document.addEventListener('pointerdown', onPointerDown)
		onCleanup(() => document.removeEventListener('pointerdown', onPointerDown))
	})

	return (
		<Show
			when={!props.scoped}
			fallback={
				<span class="app-tenant-context app-tenant-context-fixed">
					<span class="visually-hidden">{t('app.tenantContext')}: </span>
					{contextTenantRows()[0]?.name ?? '…'}
				</span>
			}
		>
			<div class="app-tenant-context" ref={root}>
				<button
					type="button"
					class="app-tenant-context-button"
					aria-haspopup="listbox"
					aria-expanded={open()}
					aria-label={`${t('app.tenantContext')}: ${currentLabel()}`}
					title={t('app.tenantContextHint')}
					onClick={() => (open() ? close() : openMenu())}
				>
					<span class="app-tenant-context-label">{currentLabel()}</span>
					<span aria-hidden="true" class="app-tenant-context-chevron">
						<IconChevronDown size={14} />
					</span>
				</button>
				<Show when={open()}>
					<div class="app-tenant-context-popover">
						<input
							ref={input}
							type="search"
							class="app-tenant-context-search"
							placeholder={t('app.tenantContextSearch')}
							aria-label={t('app.tenantContextSearch')}
							aria-controls={listId}
							aria-activedescendant={
								options()[active()] ? `${listId}-${active()}` : undefined
							}
							role="combobox"
							aria-expanded="true"
							value={query()}
							onInput={(e: InputEventAndTarget) => setQuery(e.currentTarget.value)}
							onKeyDown={onKeyDown}
						/>
						<div class="app-tenant-context-options" role="listbox" id={listId}>
							<For each={options()}>
								{(option: ContextOption, index: () => number): JSX.Element => (
									<button
										type="button"
										tabIndex={-1}
										id={`${listId}-${index()}`}
										role="option"
										aria-selected={option.key === contextKey(tenantContext())}
										classList={{
											'app-tenant-context-option': true,
											nested: option.nested,
											group: option.context.kind === 'group',
											active: index() === active(),
											selected: option.key === contextKey(tenantContext()),
										}}
										onPointerEnter={() => setActive(index())}
										// pointerdown keeps focus in the search input.
										onPointerDown={(e: PointerEvent) => e.preventDefault()}
										onClick={() => choose(option)}
									>
										{option.label}
									</button>
								)}
							</For>
						</div>
						<Show when={options().length === 0}>
							<p class="app-tenant-context-empty">
								{t('app.tenantContextNoMatch', { search: query().trim() })}
							</p>
						</Show>
						<Show when={props.canAdd}>
							<button
								type="button"
								class="app-tenant-context-add"
								classList={{ primary: options().length === 0 }}
								onClick={addTenant}
							>
								<span aria-hidden="true" class="app-nav-icon">
									<IconPlus size={14} />
								</span>
								{offerCreate()
									? t('app.tenantContextCreate', { name: query().trim() })
									: t('app.tenantContextAdd')}
							</button>
						</Show>
					</div>
				</Show>
			</div>
		</Show>
	)
}
