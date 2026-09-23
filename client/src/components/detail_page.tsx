/**
 * Shared building blocks for the entity detail pages (tenant, site,
 * location, …): the back link, the loading/empty gate, the header with
 * edit/delete actions, the detail card grid, the foreign-key link pattern,
 * the related-object sections, and the confirm-then-delete flow.
 *
 * Every piece preserves the exact DOM, strings, and classes the pages
 * rendered before, so e2e selectors keep working.
 */
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { type JSX, type Setter, Show } from 'solid-js'
import { navigate } from '../router'
import { Empty, InlineError, Loading } from './feedback'
import { go } from './list_page'

export { Empty, InlineError, Loading }

/** Back link above the detail header (`← Tenants`, …). */
export function DetailBackLink(props: { href: string; label: string }): JSX.Element {
	return (
		<p>
			<a href={props.href} onClick={(e: MouseEvent): void => go(e, props.href)}>
				← {props.label}
			</a>
		</p>
	)
}

/**
 * Detail page shell: back link plus the loading/empty gate around the
 * header block. Related sections and the terminal error render after the
 * shell, outside the gate, exactly as the hand-rolled pages did.
 */
export function DetailShell(props: {
	backTo: string
	backLabel: string
	loading: boolean
	loadingText: string
	record: unknown
	emptyText: string
	children: JSX.Element
}): JSX.Element {
	return (
		<>
			<DetailBackLink href={props.backTo} label={props.backLabel} />
			<Show when={!props.loading} fallback={<Loading message={props.loadingText} />}>
				<Show when={props.record} fallback={<Empty message={props.emptyText} />}>
					{props.children}
				</Show>
			</Show>
		</>
	)
}

/** Title header with the Edit / Delete action pair. */
export function DetailHeader(props: {
	name: string | undefined
	slug?: string
	editHref: string
	onDelete: () => void
}): JSX.Element {
	return (
		<div class="page-header">
			<h2>
				<Show when={props.slug !== undefined} fallback={props.name}>
					{props.name} <code>{props.slug}</code>
				</Show>
			</h2>
			<div class="form-actions">
				<button type="button" onClick={() => navigate(props.editHref)}>
					<span aria-hidden="true" class="app-nav-icon">
						<IconPencil size={14} />
					</span>{' '}
					Edit
				</button>
				<button type="button" class="btn-danger" onClick={props.onDelete}>
					<span aria-hidden="true" class="app-nav-icon">
						<IconTrash size={14} />
					</span>{' '}
					Delete
				</button>
			</div>
		</div>
	)
}

/** Muted one-liner under the header (description fallback, …). */
export function DetailSubtitle(props: { children: JSX.Element }): JSX.Element {
	return <p class="page-subtitle">{props.children}</p>
}

/** Card wrapping the definition grid of scalar fields. */
export function DetailCard(props: { label: string; children: JSX.Element }): JSX.Element {
	return (
		<section class="card" aria-label={props.label}>
			<dl class="detail-grid">{props.children}</dl>
		</section>
	)
}

/**
 * Parent breadcrumb rendered above the header on nested details
 * (`parent / child`).
 */
export function ParentBreadcrumb(props: {
	parentId: number | null
	parentName: string | null | undefined
	parentFallback: string
	href: string
	childName: string | undefined
}): JSX.Element {
	return (
		<Show when={props.parentId !== null}>
			<p class="page-subtitle">
				<a href={props.href} onClick={(e: MouseEvent): void => go(e, props.href)}>
					{props.parentName ?? props.parentFallback}
				</a>{' '}
				/ {props.childName}
			</p>
		</Show>
	)
}

/**
 * Foreign-key cell: the triple-nested `Show` every detail grid repeated —
 * missing id renders `—`, a pending fetch renders the `…` skeleton, a
 * dangling id renders the raw id, otherwise a link to the related object.
 * Omit `href` for FKs that render plain text (e.g. the device location).
 */
export function ForeignKeyLink(props: {
	id: number | null
	loading: boolean
	name: string | null | undefined
	href?: string
}): JSX.Element {
	return (
		<Show when={props.id !== null} fallback="—">
			<Show when={!props.loading} fallback={<span class="skeleton">…</span>}>
				<Show when={props.name} fallback={String(props.id ?? '—')}>
					{(resolved: () => string) =>
						props.href !== undefined ? (
							<a
								href={props.href}
								onClick={(e: MouseEvent): void => go(e, props.href ?? '')}
							>
								{resolved()}
							</a>
						) : (
							resolved()
						)
					}
				</Show>
			</Show>
		</Show>
	)
}

/**
 * Related-object section: `h3` with a count badge, the loading/empty gate
 * around the table, and an optional "View in … →" follow-up link.
 */
export function RelatedSection(props: {
	id?: string
	title: string
	count: number
	loading: boolean
	loadingText: string
	emptyText: string
	hasItems: boolean
	children: JSX.Element
	viewAllHref?: string
	viewAllLabel?: string
}): JSX.Element {
	return (
		<>
			<h3 id={props.id}>
				{props.title} <span class="badge">{props.count}</span>
			</h3>
			<Show when={!props.loading} fallback={<Loading message={props.loadingText} />}>
				<Show when={props.hasItems} fallback={<Empty message={props.emptyText} />}>
					{props.children}
				</Show>
			</Show>
			<Show when={props.viewAllHref !== undefined}>
				<p>
					<a
						href={props.viewAllHref ?? ''}
						onClick={(e: MouseEvent): void => go(e, props.viewAllHref ?? '')}
					>
						{props.viewAllLabel ?? 'View all →'}
					</a>
				</p>
			</Show>
		</>
	)
}

/**
 * Confirm-then-delete flow shared by every detail page: confirms with the
 * entity noun/name, reports through `setError`, and navigates back to the
 * list with a refresh.
 */
export function useDetailDelete(opts: {
	noun: string
	name: () => string | undefined
	id: number
	remove: (id: number) => Promise<Result<unknown, Error>>
	setError: Setter<string | null>
	listRoute: string
}): { handleDelete: () => Promise<void> } {
	async function handleDelete(): Promise<void> {
		const name = opts.name()
		if (!name) {
			return
		}
		if (!window.confirm(`Delete ${opts.noun} "${name}"?`)) {
			return
		}
		opts.setError(null)
		const res = await opts.remove(opts.id)
		if (Result.isError(res)) {
			opts.setError(res.error.message)
			return
		}
		navigate(opts.listRoute, { refresh: true })
	}

	return { handleDelete }
}
