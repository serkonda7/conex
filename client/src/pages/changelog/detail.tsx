import { createSignal, For, type JSX, Show } from 'solid-js'
import { fetch_object_change, type ObjectChangeJson } from '../../api/changelog'
import { DetailCard, DetailShell } from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { t } from '../../i18n'
import { changeObjectLabel } from '../../i18n/labels'
import { createRecord } from '../../lib/resource'
import { formatTime } from '../../lib/time'
import { ChangeActionBadge, ChangedObjectLink, changeUser } from './common'

interface FieldDiff {
	field: string
	before: unknown
	after: unknown
	changed: boolean
}

/**
 * Every field of either snapshot with its before/after value, sorted by
 * name (`jsonb` keeps no column order).
 */
function diffFields(change: ObjectChangeJson): FieldDiff[] {
	const before = change.prechange_data ?? {}
	const after = change.postchange_data ?? {}
	const fields = [...new Set([...Object.keys(after), ...Object.keys(before)])].sort()
	return fields.map((field) => ({
		field,
		before: before[field],
		after: after[field],
		changed: JSON.stringify(before[field]) !== JSON.stringify(after[field]),
	}))
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined || value === '') {
		return '—'
	}
	return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * /changelog/:id — one change: who changed which object when, and a
 * field-by-field before/after table. Updates list only the changed fields
 * unless unchanged ones are requested.
 */
export function ChangeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [change] = createRecord(() => props.id, fetch_object_change, setError)
	const [showAll, setShowAll] = createSignal(false)

	const rows = (): FieldDiff[] => {
		const c = change()
		if (!c) {
			return []
		}
		const all = diffFields(c)
		return c.action === 'update' && !showAll() ? all.filter((d) => d.changed) : all
	}

	return (
		<div>
			<DetailShell
				name={t('changelog.title', { id: props.id })}
				record={change}
				loadingText={t('changelog.loadingOne')}
				emptyText={t('changelog.notFound')}
			>
				<Show when={change()}>
					{(c: () => ObjectChangeJson): JSX.Element => (
						<>
							<div class="page-header">
								<h2>
									{t('changelog.title', { id: c().id })}{' '}
									<ChangeActionBadge action={c().action} />
								</h2>
							</div>

							<DetailCard label={t('changelog.summary')}>
								<dt>{t('changelog.time')}</dt>
								<dd>{formatTime(c().created_at)}</dd>
								<dt>{t('changelog.user')}</dt>
								<dd>{changeUser(c())}</dd>
								<dt>{t('changelog.objectType')}</dt>
								<dd>{changeObjectLabel(c().object_type)}</dd>
								<dt>{t('changelog.object')}</dt>
								<dd>
									<ChangedObjectLink change={c()} />
								</dd>
								<dt>{t('changelog.requestId')}</dt>
								<dd>
									<code>{c().request_id ?? '—'}</code>
								</dd>
							</DetailCard>

							<section aria-label={t('changelog.difference')}>
								<div class="page-header">
									<h3>{t('changelog.difference')}</h3>
									<Show when={c().action === 'update'}>
										<label>
											<input
												type="checkbox"
												checked={showAll()}
												onChange={(
													e: Event & { currentTarget: HTMLInputElement },
												): void => {
													setShowAll(e.currentTarget.checked)
												}}
											/>{' '}
											{t('changelog.showAllFields')}
										</label>
									</Show>
								</div>
								<Show
									when={rows().length > 0}
									fallback={
										<p class="text-muted">{t('changelog.noDifference')}</p>
									}
								>
									<table class="changelog-diff">
										<thead>
											<tr>
												<th>{t('changelog.field')}</th>
												<th>{t('changelog.before')}</th>
												<th>{t('changelog.after')}</th>
											</tr>
										</thead>
										<tbody>
											<For each={rows()}>
												{(d: FieldDiff): JSX.Element => (
													<tr>
														<td>
															<code>{d.field}</code>
														</td>
														<td
															class={
																d.changed && c().prechange_data
																	? 'diff-removed'
																	: undefined
															}
														>
															{formatValue(d.before)}
														</td>
														<td
															class={
																d.changed && c().postchange_data
																	? 'diff-added'
																	: undefined
															}
														>
															{formatValue(d.after)}
														</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</Show>
							</section>
						</>
					)}
				</Show>
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}
