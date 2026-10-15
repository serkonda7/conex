import type { ServiceLevelTargetJson, ServiceWindow } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { delete_service_level, fetch_service_level } from '../../api/service_catalog'
import { DataTable } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	useDetailDelete,
} from '../../components/detail_page'
import { Empty, InlineError } from '../../components/feedback'
import { Markdown } from '../../components/markdown'
import { t } from '../../i18n'
import { holidayRegionLabel } from '../../i18n/labels'
import { createRecord } from '../../lib/resource'
import { formatMinutes, weekdayLabel } from '../../lib/service_level'

/**
 * /service-levels/:id — service level detail: service hours, holiday
 * calendar and the response/resolution targets per priority.
 */
export function ServiceLevelDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [level] = createRecord(id, fetch_service_level, setError)

	const handleDelete = useDetailDelete({
		noun: 'noun.serviceLevel',
		name: () => level()?.name,
		id: props.id,
		remove: delete_service_level,
		setError,
		listRoute: '/service-levels',
	})

	const targets = (): ServiceLevelTargetJson[] => level()?.targets ?? []

	return (
		<div>
			<DetailShell
				name={level()?.name}
				record={level}
				loadingText={t('serviceLevel.loadingOne')}
				emptyText={t('serviceLevel.notFound')}
			>
				<DetailHeader
					name={level()?.name}
					editHref={`/service-levels/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={level()?.description} />

				<DetailCard label={t('serviceLevel.details')}>
					<dt>{t('serviceLevel.serviceHours')}</dt>
					<dd>
						<Show
							when={(level()?.service_hours ?? []).length > 0}
							fallback={t('serviceLevel.noServiceHours')}
						>
							<ul class="service-hours-list">
								<For each={level()?.service_hours}>
									{(w: ServiceWindow): JSX.Element => (
										<li>
											<span>{weekdayLabel(w.day, 'long')}</span>
											<span>
												{w.from}–{w.to}
											</span>
										</li>
									)}
								</For>
							</ul>
						</Show>
					</dd>
					<dt>{t('serviceLevel.holidayRegion')}</dt>
					<dd>
						{level()?.holiday_region == null
							? t('serviceLevel.holidayNationwide')
							: holidayRegionLabel(level()?.holiday_region ?? '')}
					</dd>
					<dt>{t('common.comments')}</dt>
					<dd>
						<Markdown text={level()?.comments} />
					</dd>
				</DetailCard>

				<h3 id="service-level-targets">{t('serviceLevel.targets')}</h3>
				<Show
					when={targets().length > 0}
					fallback={<Empty message={t('serviceLevel.noTargets')} />}
				>
					<DataTable
						rows={targets}
						getRowId={(r: ServiceLevelTargetJson): number => r.priority_id}
						empty={false}
						columns={[
							{
								key: 'priority',
								label: t('entity.priority.one'),
								getValue: (r: ServiceLevelTargetJson): JSX.Element => (
									<a href={`/priorities/${r.priority_id}`}>{r.priority_name}</a>
								),
							},
							{
								key: 'response',
								label: t('serviceLevel.response'),
								getValue: (r: ServiceLevelTargetJson): string =>
									formatMinutes(r.response_minutes),
							},
							{
								key: 'resolution',
								label: t('serviceLevel.resolution'),
								getValue: (r: ServiceLevelTargetJson): string =>
									r.resolution_minutes === null
										? t('serviceLevel.bestEffort')
										: formatMinutes(r.resolution_minutes),
							},
							{
								key: 'clock',
								label: t('serviceLevel.clock'),
								getValue: (r: ServiceLevelTargetJson): string =>
									r.around_the_clock
										? t('serviceLevel.aroundTheClock')
										: t('serviceLevel.withinServiceHours'),
							},
						]}
					/>
				</Show>
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}
