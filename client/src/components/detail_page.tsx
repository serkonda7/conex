/**
 * Shared building blocks for the entity detail pages (tenant, site,
 * location, …): the tab title and breadcrumb report, the loading/empty gate, the header with
 * edit/delete actions, the detail card grid, the foreign-key link pattern,
 * the related-object sections, and the confirm-then-delete flow.
 *
 * Every piece preserves the exact DOM and classes the pages rendered
 * before, so e2e selectors keep working.
 */
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { type JSX, type Setter, Show } from 'solid-js'
import { type PluralKey, t, tp } from '../i18n'
import { type Crumb, forgetDeleted, goTo, navigate, usePageMeta } from '../router'
import { Empty, InlineError, Loading } from './feedback'

export { Empty, InlineError, Loading }

/**
 * Detail page shell: reports the object's name and ancestors to the tab
 * title and breadcrumb bar, and gates the header block on loading/empty.
 * Related sections and the terminal error render after the shell, outside
 * the gate, exactly as the hand-rolled pages did.
 */
export function DetailShell(props: {
	name: string | undefined
	crumbs?: readonly Crumb[]
	loading: boolean
	loadingText: string
	record: unknown
	emptyText: string
	children: JSX.Element
}): JSX.Element {
	usePageMeta(() => ({ name: props.name, crumbs: props.crumbs }))
	return (
		<Show when={!props.loading} fallback={<Loading message={props.loadingText} />}>
			<Show when={props.record} fallback={<Empty message={props.emptyText} />}>
				{props.children}
			</Show>
		</Show>
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
					{t('common.edit')}
				</button>
				<button type="button" class="btn-danger" onClick={props.onDelete}>
					<span aria-hidden="true" class="app-nav-icon">
						<IconTrash size={14} />
					</span>{' '}
					{t('common.delete')}
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
								onClick={(e: MouseEvent): void => goTo(e, props.href ?? '')}
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
						onClick={(e: MouseEvent): void => goTo(e, props.viewAllHref ?? '')}
					>
						{props.viewAllLabel ?? t('common.viewAll')}
					</a>
				</p>
			</Show>
		</>
	)
}

/**
 * Confirm-then-delete flow shared by every detail page: confirms with the
 * entity noun (a `noun.<entity>` plural key) and name, reports through
 * `setError`, then drops the object from the open tabs and shows the
 * previous page or the refreshed list.
 */
export function useDetailDelete(opts: {
	noun: PluralKey
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
		if (!window.confirm(t('list.confirmDelete', { noun: tp(opts.noun, 1), name }))) {
			return
		}
		opts.setError(null)
		const res = await opts.remove(opts.id)
		if (Result.isError(res)) {
			opts.setError(res.error.message)
			return
		}
		forgetDeleted(`${opts.listRoute}/${opts.id}`, opts.listRoute)
	}

	return { handleDelete }
}
