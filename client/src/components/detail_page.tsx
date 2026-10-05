/**
 * Shared building blocks for the entity detail pages (tenant, site,
 * location, …): the tab title and breadcrumb report, the loading/empty
 * gate, the header with edit/delete actions, the detail card grid, the
 * foreign-key link pattern, the related-object sections, and the
 * confirm-then-delete flow.
 */
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { type JSX, type Resource, type Setter, Show } from 'solid-js'
import { type PluralKey, t, tp } from '../i18n'
import { type Crumb, forgetDeleted, navigate, usePageMeta } from '../lib/router'
import { can } from '../lib/session'
import { DataTable, type DataTableColumn } from './data_table'
import { Empty, Loading } from './feedback'
import { IconLabel } from './icon_label'

/**
 * Detail page shell: reports the object's name and ancestors to the tab
 * title and breadcrumb bar, and gates the header block on loading/empty.
 * Related sections and the terminal error render after the shell, outside
 * the gate.
 */
export function DetailShell(props: {
	name: string | undefined
	crumbs?: readonly Crumb[]
	record: Resource<unknown>
	loadingText: string
	emptyText: string
	children: JSX.Element
}): JSX.Element {
	usePageMeta(() => ({ name: props.name, crumbs: props.crumbs }))
	return (
		<Show when={!props.record.loading} fallback={<Loading message={props.loadingText} />}>
			<Show when={props.record()} fallback={<Empty message={props.emptyText} />}>
				{props.children}
			</Show>
		</Show>
	)
}

/**
 * Title header with the Edit / Delete actions, each shown only with the
 * matching permission.
 * `extra` follows the name inside the heading (e.g. the rack height).
 */
export function DetailHeader(props: {
	name: string | undefined
	slug?: string
	extra?: JSX.Element
	testId?: string
	editHref: string
	onDelete: () => void
	/** False hides "Delete" (e.g. built-in records). */
	deletable?: boolean
}): JSX.Element {
	return (
		<div class="page-header">
			<h2 data-testid={props.testId}>
				{props.name}
				<Show when={props.slug !== undefined}>
					{' '}
					<code>{props.slug}</code>
				</Show>
				<Show when={props.extra}> {props.extra}</Show>
			</h2>
			<Show when={can('edit') || (can('delete') && props.deletable !== false)}>
				<div class="form-actions">
					<Show when={can('edit')}>
						<button type="button" onClick={() => navigate(props.editHref)}>
							<IconLabel icon={IconPencil}>{t('common.edit')}</IconLabel>
						</button>
					</Show>
					<Show when={can('delete') && props.deletable !== false}>
						<button type="button" class="btn-danger" onClick={props.onDelete}>
							<IconLabel icon={IconTrash}>{t('common.delete')}</IconLabel>
						</button>
					</Show>
				</div>
			</Show>
		</div>
	)
}

/** Muted one-liner under the header: the description, or a placeholder. */
export function DetailSubtitle(props: { description: string | null | undefined }): JSX.Element {
	return <p class="page-subtitle">{props.description || t('common.noDescription')}</p>
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
 * Foreign-key cell: a missing id renders `—`, a pending fetch the `…`
 * skeleton, a dangling id the raw id, otherwise a link to the related
 * object. Omit `href` for FKs that render plain text.
 */
export function ForeignKeyLink(props: {
	id: number | null | undefined
	loading: boolean
	name: string | null | undefined
	href?: string
}): JSX.Element {
	const link = (name: string): JSX.Element =>
		props.href === undefined ? name : <a href={props.href}>{name}</a>
	return (
		<Show when={props.id !== null && props.id !== undefined} fallback="—">
			<Show when={!props.loading} fallback={<span class="skeleton">…</span>}>
				<Show when={props.name} fallback={String(props.id)}>
					{(name: () => string) => link(name())}
				</Show>
			</Show>
		</Show>
	)
}

/** {@link ForeignKeyLink} for a record resource: links `<base>/<id>` by name. */
export function RecordLink(props: {
	id: number | null | undefined
	record: Resource<{ name: string } | null>
	base: string
}): JSX.Element {
	return (
		<ForeignKeyLink
			id={props.id}
			loading={props.record.loading}
			name={props.record()?.name}
			href={`${props.base}/${props.id ?? ''}`}
		/>
	)
}

/**
 * Related-object section: `h3` with a count badge, the loading/empty gate
 * around a table of `rows` (or custom `children`), and an optional
 * "View in … →" follow-up link.
 */
export function RelatedSection<Row extends { id: number }>(props: {
	id: string
	title: string
	rows: Resource<Row[]>
	/** Plural `noun.<entity>` key for the default loading text. */
	noun?: PluralKey
	loadingText?: string
	emptyText: string
	columns?: DataTableColumn<Row>[]
	/** Rows to show and count, derived from `rows` (e.g. reordered or narrowed). */
	select?: (rows: Row[]) => Row[]
	customizable?: boolean
	viewAllHref?: string
	children?: JSX.Element
}): JSX.Element {
	const shown = (): Row[] => {
		const rows = props.rows() ?? []
		return props.select ? props.select(rows) : rows
	}
	const count = (): number => shown().length
	const loadingText = (): string =>
		props.loadingText ??
		t('list.loading', { noun: props.noun ? tp(props.noun, 2) : props.title })
	return (
		<>
			<h3 id={props.id}>
				{props.title} <span class="badge">{count()}</span>
			</h3>
			<Show when={!props.rows.loading} fallback={<Loading message={loadingText()} />}>
				<Show when={count() > 0} fallback={<Empty message={props.emptyText} />}>
					<Show when={props.columns} fallback={props.children}>
						{(columns: () => DataTableColumn<Row>[]) => (
							<DataTable
								rows={shown}
								getRowId={(row: Row): number => row.id}
								showColumnCustomizer={props.customizable}
								columns={columns()}
							/>
						)}
					</Show>
				</Show>
			</Show>
			<Show when={props.viewAllHref}>
				{(href: () => string) => (
					<p>
						<a href={href()}>{t('common.viewIn', { target: props.title })}</a>
					</p>
				)}
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
}): () => Promise<void> {
	return async (): Promise<void> => {
		const name = opts.name()
		if (!name || !window.confirm(t('list.confirmDelete', { noun: tp(opts.noun, 1), name }))) {
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
}
