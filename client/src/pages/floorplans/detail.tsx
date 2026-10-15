import { createSignal, type JSX, Show } from 'solid-js'
import { type AttachmentJson, fetch_attachment } from '../../api/attachments'
import { fetch_location, fetch_site, type SiteRow } from '../../api/tenancy'
import { DetailShell } from '../../components/detail_page'
import { Empty, InlineError } from '../../components/feedback'
import { FloorplanView } from '../../components/floorplan'
import { t, tp } from '../../i18n'
import { createRecord } from '../../lib/resource'

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

	return (
		<div>
			<DetailShell
				name={name()}
				record={attachment}
				loadingText={t('floorplan.loading')}
				emptyText={t('floorplan.notFound')}
			>
				<Show
					when={attachment()?.is_floorplan ? attachment() : undefined}
					fallback={<Empty message={t('floorplan.notFound')} />}
				>
					{(marked: () => AttachmentJson) => (
						<>
							<FloorplanView attachment={marked()} title={name() ?? ''} />
							<p class="page-subtitle">
								<Show
									when={marked().location_id !== null}
									fallback={
										<>
											{tp('entity.site', 1)}:{' '}
											<a href={`/sites/${marked().site_id}`}>{name()}</a>
										</>
									}
								>
									{tp('entity.location', 1)}:{' '}
									<a href={`/locations/${marked().location_id}`}>{name()}</a>
									<Show when={locationSite()}>
										{(site: () => SiteRow) => (
											<>
												{' · '}
												{tp('entity.site', 1)}:{' '}
												<a href={`/sites/${site().id}`}>{site().name}</a>
											</>
										)}
									</Show>
								</Show>
							</p>
						</>
					)}
				</Show>
			</DetailShell>
			<InlineError message={error()} />
		</div>
	)
}
