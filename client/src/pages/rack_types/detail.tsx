import { createSignal, type JSX, Show } from 'solid-js'
import type { RackRow } from '../../api/racks'
import { fetch_racks } from '../../api/racks'
import { delete_rack_type, fetch_manufacturer, fetch_rack_type } from '../../api/templates'
import { nameColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import { formFactorLabel } from '../../i18n/labels'
import { createRecord, createRowsFor } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { SpecLink } from '../device_types/spec_link'

/** /rack-types/:id — rack type detail: specification and the racks of this type. */
export function RackTypeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [rackType] = createRecord(id, fetch_rack_type, setError)
	const manufacturerId = (): number | undefined => rackType()?.manufacturer_id
	const [manufacturer] = createRecord(manufacturerId, fetch_manufacturer, setError)
	const [racks] = createRowsFor(id, (key: number) => fetch_racks({ rack_type: [key] }), setError)

	const manufacturerCrumbs = (): Crumb[] => {
		const row = manufacturer()
		return row ? [{ label: row.name, href: `/manufacturers/${row.id}` }] : []
	}

	const handleDelete = useDetailDelete({
		noun: 'noun.rackType',
		name: () => rackType()?.model,
		id: props.id,
		remove: delete_rack_type,
		setError,
		listRoute: '/rack-types',
	})

	return (
		<div>
			<DetailShell
				name={rackType()?.model}
				crumbs={manufacturerCrumbs()}
				record={rackType}
				loadingText={t('rackType.loadingOne')}
				emptyText={t('rackType.notFound')}
			>
				<DetailHeader
					name={rackType()?.model}
					editHref={`/rack-types/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={rackType()?.description} />

				<section class="spec-sheet" aria-label={t('rackType.details')}>
					<section>
						<h4>{t('deviceType.section.hardware')}</h4>
						<dl>
							<dt>{tp('entity.manufacturer', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={manufacturerId()}
									loading={manufacturer.loading}
									name={manufacturer()?.name}
									href={`/manufacturers/${manufacturerId() ?? ''}`}
								/>
							</dd>
							<dt>{t('deviceType.partNumber')}</dt>
							<dd>{rackType()?.part_number || '—'}</dd>
							<dt>{t('deviceType.specUrl')}</dt>
							<dd>
								<Show when={rackType()?.spec_url} fallback="—">
									{(url: () => string): JSX.Element => <SpecLink url={url()} />}
								</Show>
							</dd>
						</dl>
					</section>
					<section>
						<h4>{t('deviceType.section.physical')}</h4>
						<dl>
							<dt>{t('rackType.formFactor')}</dt>
							<dd>{formFactorLabel(rackType()?.form_factor ?? '')}</dd>
							<dt>{t('rackType.widthInches')}</dt>
							<dd>{rackType()?.width}</dd>
							<dt>{t('common.heightU')}</dt>
							<dd>{rackType()?.u_height}</dd>
						</dl>
					</section>
					<Show when={rackType()?.comments}>
						<section class="spec-sheet-notes">
							<h4>{t('common.comments')}</h4>
							<Markdown text={rackType()?.comments} />
						</section>
					</Show>
				</section>
			</DetailShell>

			<RelatedSection
				id="rack-type-racks"
				title={tp('entity.rack', 2)}
				noun="noun.rack"
				rows={racks}
				emptyText={t('rackType.noRacks')}
				viewAllHref={`/racks?rack_type=${props.id}`}
				columns={[nameColumn<RackRow>(tp('entity.rack', 1), '/racks')]}
			/>

			<InlineError message={error()} />
		</div>
	)
}
