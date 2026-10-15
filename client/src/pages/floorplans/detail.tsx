import { createResource, createSignal, type JSX, Show } from 'solid-js'
import { type AttachmentJson, fetch_attachment } from '../../api/attachments'
import { fetch_location, fetch_site } from '../../api/tenancy'
import { DetailShell } from '../../components/detail_page'
import { Empty, InlineError } from '../../components/feedback'
import { FloorplanView } from '../../components/floorplan'
import { t } from '../../i18n'
import { createRecord } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { siteTrail } from '../../lib/trails'

/**
 * /floorplans/:id — the floor plan of a site or location (`id` is the
 * marked image's attachment id): the plan with its areas and markers, and
 * the editor. The owner's page links here from its details.
 */
export function FloorplanDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [attachment] = createRecord(() => props.id, fetch_attachment, setError)
	const [ownerSite] = createRecord(() => attachment()?.site_id, fetch_site, setError)
	const [location] = createRecord(() => attachment()?.location_id, fetch_location, setError)
	const [locationSite] = createRecord(() => location()?.site_id, fetch_site, setError)
	const name = (): string | undefined => ownerSite()?.name ?? location()?.name
	// Floor plans › site › location and its parents › owner (linked) › this page.
	const [ownerTrail] = createResource(
		() => ({
			site: ownerSite() ?? locationSite(),
			location: attachment()?.location_id ?? null,
		}),
		({ site, location: locationId }): Promise<Crumb[]> => siteTrail(site, locationId),
	)

	return (
		<div>
			<DetailShell
				name={
					name() === undefined
						? undefined
						: t('floorplan.pageName', { name: name() ?? '' })
				}
				crumbs={ownerTrail()}
				record={attachment}
				loadingText={t('floorplan.loading')}
				emptyText={t('floorplan.notFound')}
			>
				<Show
					when={attachment()?.is_floorplan ? attachment() : undefined}
					fallback={<Empty message={t('floorplan.notFound')} />}
				>
					{(marked: () => AttachmentJson) => (
						<FloorplanView attachment={marked()} title={name() ?? ''} />
					)}
				</Show>
			</DetailShell>
			<InlineError message={error()} />
		</div>
	)
}
