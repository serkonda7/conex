import { createSignal, type JSX, Show } from 'solid-js'
import { type FloorplanDrawingJson, fetch_drawing } from '../../api/floorplan_drawings'
import { fetch_location, fetch_site } from '../../api/tenancy'
import { DetailShell } from '../../components/detail_page'
import { DrawnPlanView } from '../../components/drawn_plan'
import { InlineError } from '../../components/feedback'
import { t } from '../../i18n'
import { createDerived, createRecord } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { siteTrail } from '../../lib/trails'

/**
 * /floorplans-v2/:id — the drawn floor plan of a site or location: the
 * drawing with its markers, and the editor. The owner's page links here.
 */
export function DrawnFloorplanDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [drawing, { mutate }] = createRecord(() => props.id, fetch_drawing, setError)
	const [ownerSite] = createRecord(() => drawing()?.site_id, fetch_site, setError)
	const [location] = createRecord(() => drawing()?.location_id, fetch_location, setError)
	const [locationSite] = createRecord(() => location()?.site_id, fetch_site, setError)
	const title = (): string | undefined => {
		const loaded = drawing()
		return loaded ? t('drawnPlan.pageName', { name: loaded.owner_name }) : undefined
	}
	// Drawn floor plans › site › location and its parents › this page.
	const ownerTrail = createDerived(
		() => ({
			site: ownerSite() ?? locationSite(),
			location: drawing()?.location_id ?? null,
		}),
		({ site, location: locationId }): Promise<Crumb[]> => siteTrail(site, locationId),
	)

	return (
		<div>
			<DetailShell
				name={title()}
				crumbs={ownerTrail()}
				record={drawing}
				loadingText={t('drawnPlan.loading')}
				emptyText={t('drawnPlan.notFound')}
			>
				<Show when={drawing()}>
					{(loaded: () => FloorplanDrawingJson) => (
						<DrawnPlanView
							drawing={loaded()}
							title={title() ?? ''}
							on_saved={(saved: FloorplanDrawingJson) => mutate(saved)}
						/>
					)}
				</Show>
			</DetailShell>
			<InlineError message={error()} />
		</div>
	)
}
