/**
 * Global tenant context: the top-bar selection of "all tenants", one
 * tenant group, or one tenant. List pages and create
 * forms read it; detail pages and catalog data ignore it. The choice is
 * shared by all tabs and persisted to localStorage (`conex:tenant-context`).
 *
 * Scoped users are limited to their own tenant server-side, so for them the
 * context always reads as "all" and the selector shows a fixed label.
 */
import { Result } from 'better-result'
import { createEffect, createMemo, createSignal } from 'solid-js'
import {
	fetch_tenant_groups,
	fetch_tenants,
	type TenantGroupRow,
	type TenantRow,
} from '../api/tenancy'
import { id_value } from './form'
import { parseId, queryParam } from './router'

export type TenantContext =
	| { kind: 'all' }
	| { kind: 'group'; id: number }
	| { kind: 'tenant'; id: number }

/** List-query params derived from the context. */
export interface TenantContextFilters {
	tenant?: number
	tenant_group?: number
}

const STORAGE_KEY = 'conex:tenant-context'

const ALL: TenantContext = { kind: 'all' }

function parseStored(raw: string | null): TenantContext {
	const match = raw?.match(/^(group|tenant):(\d+)$/)
	if (!match) {
		return ALL
	}
	const id = Number(match[2])
	return match[1] === 'group' ? { kind: 'group', id } : { kind: 'tenant', id }
}

function initialContext(): TenantContext {
	try {
		if (typeof window !== 'undefined') {
			return parseStored(window.localStorage.getItem(STORAGE_KEY))
		}
	} catch {
		// Storage unavailable (private mode, …): start unfiltered.
	}
	return ALL
}

const [selected, setSelected] = createSignal<TenantContext>(initialContext())
const [scoped, setScoped] = createSignal(false)
const [tenants, setTenants] = createSignal<TenantRow[]>([])
const [groups, setGroups] = createSignal<TenantGroupRow[]>([])

/** Tenants and tenant groups offered by the selector. */
export { groups as contextGroups, tenants as contextTenantRows }

/** Effective context; always "all" for scoped users. */
export function tenantContext(): TenantContext {
	return scoped() ? ALL : selected()
}

export function setTenantContext(next: TenantContext): void {
	setSelected(next)
	try {
		if (next.kind === 'all') {
			window.localStorage.removeItem(STORAGE_KEY)
		} else {
			window.localStorage.setItem(STORAGE_KEY, `${next.kind}:${next.id}`)
		}
	} catch {
		// Storage unavailable: the choice lasts for this session only.
	}
}

/** Marks the session as tenant-scoped (see module doc). */
export function setTenantContextScoped(value: boolean): void {
	setScoped(value)
}

/**
 * Reloads the tenant and tenant-group lists for the selector. A stored
 * context naming a tenant or group that no longer exists falls back to
 * "all" so lists never filter on a dangling id.
 */
export async function refreshTenantContext(): Promise<void> {
	const [tenantRes, groupRes] = await Promise.all([fetch_tenants(), fetch_tenant_groups()])
	if (Result.isError(tenantRes) || Result.isError(groupRes)) {
		return
	}
	setTenants(tenantRes.value.items)
	setGroups(groupRes.value.items)
	const current = selected()
	const exists =
		current.kind === 'all' ||
		(current.kind === 'group'
			? groupRes.value.items.some((g) => g.id === current.id)
			: tenantRes.value.items.some((row) => row.id === current.id))
	if (!exists) {
		setTenantContext(ALL)
	}
}

/**
 * List-query filters for a page. An explicit per-page tenant filter (e.g.
 * `?tenant=` from a "view all" link) wins over the context.
 */
export function tenantContextFilters(pageTenant?: number): TenantContextFilters {
	if (pageTenant !== undefined) {
		return { tenant: pageTenant }
	}
	const ctx = tenantContext()
	if (ctx.kind === 'tenant') {
		return { tenant: ctx.id }
	}
	if (ctx.kind === 'group') {
		return { tenant_group: ctx.id }
	}
	return {}
}

/** Tenant group id of the context, if a group is selected. */
export function contextGroupId(): number | undefined {
	const ctx = tenantContext()
	return ctx.kind === 'group' ? ctx.id : undefined
}

/** Tenant to prefill on create forms: only when a single tenant is selected. */
export function contextTenantId(): number | null {
	const ctx = tenantContext()
	return ctx.kind === 'tenant' ? ctx.id : null
}

/** `contextTenantId` as a `<select>` value (`''` = no tenant). */
export function contextTenantValue(): string {
	return String(contextTenantId() ?? '')
}

/** True when a tenant row lies inside the context (for per-page dropdowns). */
export function inTenantContext(row: { id: number; tenant_group_id: number | null }): boolean {
	const ctx = tenantContext()
	if (ctx.kind === 'group') {
		return row.tenant_group_id === ctx.id
	}
	if (ctx.kind === 'tenant') {
		return row.id === ctx.id
	}
	return true
}

/** Rows owned by `tenant` (null: all rows). */
export function rowsOfTenant<T extends { tenant_id: number | null }>(
	rows: T[],
	tenant: number | null,
): T[] {
	return tenant === null ? rows : rows.filter((row) => row.tenant_id === tenant)
}

/**
 * Tenant select of a create form: follows the tenant of the selected parent
 * (site, site group, …) until the user picks one explicitly. An explicit
 * `?tenant=` counts as picked; without a parent tenant a single-tenant
 * context preselects it.
 */
export function useTenantDefault(
	inherited: () => number | null,
	ready: () => boolean,
): {
	value: () => string
	/** Explicit user choice: stops following the parent. */
	pick: (value: string) => void
	/** Whether the value was picked rather than inherited. */
	touched: () => boolean
	/**
	 * Tenant picked or preselected by the context, never the inherited one:
	 * filtering the parent options by that would hide all other parents.
	 */
	selected: () => number | null
} {
	const explicit = queryParam('tenant')
	const [value, setValue] = createSignal(explicit || contextTenantValue())
	const [touched, setTouched] = createSignal(explicit !== '')
	createEffect(() => {
		if (touched() || !ready()) {
			return
		}
		setValue(id_value(inherited()) || contextTenantValue())
	})
	return {
		value,
		pick: (next: string): void => {
			setTouched(true)
			setValue(next)
		},
		touched,
		selected: () => (touched() ? parseId(value()) : contextTenantId()),
	}
}

/**
 * Site select of a create form whose tenant follows the site (locations,
 * racks, devices): the tenant defaults to the selected site's tenant until
 * picked explicitly, and a selected tenant only offers its own sites. A
 * selected site of another tenant (e.g. from `?site=`) is dropped through
 * `onDrop`.
 */
export function useSiteTenant<S extends { id: number; tenant_id: number | null }>(
	sites: () => S[] | undefined,
	siteId: () => string,
	onDrop: () => void,
): {
	site: () => S | undefined
	/** Tenant of the selected site, which the tenant select inherits. */
	siteTenantId: () => number | null
	siteOptions: () => S[]
	tenant: ReturnType<typeof useTenantDefault>
} {
	const site = createMemo(() => {
		const id = parseId(siteId())
		return (sites() ?? []).find((row) => row.id === id)
	})
	const siteTenantId = (): number | null => site()?.tenant_id ?? null
	const tenant = useTenantDefault(siteTenantId, () => sites() !== undefined)
	const siteOptions = createMemo(() => rowsOfTenant(sites() ?? [], tenant.selected()))
	createEffect(() => {
		const current = site()
		if (current !== undefined && !siteOptions().includes(current)) {
			onDrop()
		}
	})
	return { site, siteTenantId, siteOptions, tenant }
}
