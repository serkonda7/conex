/**
 * Detail-grid row of a site's or location's drawn floor plan: a link to it,
 * or for an editor without one a button that creates it and opens the
 * editor. Kept apart from `drawn_plan.tsx`, so owner pages do not load the
 * editor.
 */
import { Result } from 'better-result'
import { type JSX, Show } from 'solid-js'
import { create_drawing, type DrawingOwner, fetch_drawing_ref } from '../api/floorplan_drawings'
import { t } from '../i18n'
import { createRecord, type ErrorSink, useAction } from '../lib/resource'
import { navigate } from '../lib/router'
import { can } from '../lib/session'

export function DrawnPlanLink(props: { owner: DrawingOwner; onError: ErrorSink }): JSX.Element {
	const [ref] = createRecord(() => props.owner, fetch_drawing_ref, props.onError)
	const create = useAction((message: string | null) => {
		if (message !== null) {
			props.onError(message)
		}
	})
	const onCreate = async (): Promise<void> => {
		let id: number | undefined
		const ok = await create.run(async () => {
			const res = await create_drawing(props.owner)
			if (Result.isOk(res)) {
				id = res.value.id
			}
			return res
		})
		if (ok && id !== undefined) {
			navigate(`/floorplans-v2/${id}?edit=1`)
		}
	}
	return (
		<Show when={!ref.loading && (ref() || can('edit'))}>
			<dt>{t('entity.drawnFloorplan.one')}</dt>
			<dd>
				<Show
					when={ref()}
					fallback={
						<button
							type="button"
							class="floorplan-link-button"
							disabled={create.pending()}
							onClick={() => void onCreate()}
						>
							{create.pending() ? t('drawnPlan.creating') : t('drawnPlan.create')}
						</button>
					}
				>
					{(found: () => { id: number }) => (
						<a href={`/floorplans-v2/${found().id}`}>{t('drawnPlan.open')}</a>
					)}
				</Show>
			</dd>
		</Show>
	)
}
