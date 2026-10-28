import { createSignal, type JSX } from 'solid-js'
import { delete_priority, fetch_priority } from '../../api/service_catalog'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { PriorityPill } from '../../components/priority_pill'
import { t } from '../../i18n'
import { createRecord } from '../../lib/resource'

/** /priorities/:id — priority detail: rank. */
export function PriorityDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [priority] = createRecord(id, fetch_priority, setError)

	const handleDelete = useDetailDelete({
		noun: 'noun.priority',
		name: () => priority()?.name,
		id: props.id,
		remove: delete_priority,
		setError,
		listRoute: '/priorities',
	})

	return (
		<div>
			<DetailShell
				name={priority()?.name}
				record={priority}
				loadingText={t('priority.loadingOne')}
				emptyText={t('priority.notFound')}
			>
				<DetailHeader
					name={priority()?.name}
					editHref={`/priorities/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={priority()?.description} />

				<DetailCard label={t('priority.details')}>
					<dt>{t('priority.rank')}</dt>
					<dd>{priority()?.rank}</dd>
					<dt>{t('priority.color')}</dt>
					<dd>
						<PriorityPill
							name={priority()?.name ?? ''}
							color={priority()?.color ?? '#6b7280'}
						/>
					</dd>
				</DetailCard>
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}
