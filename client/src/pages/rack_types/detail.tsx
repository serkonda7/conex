import { createSignal, type JSX, Show } from 'solid-js'
import type { RackRow } from '../../api/racks'
import { fetch_racks } from '../../api/racks'
import {
	delete_rack_type,
	fetch_manufacturer,
	fetch_rack_type,
	type RackTypeRow,
} from '../../api/templates'
import { nameColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RecordLink,
	RelatedSection,
	SpecSheetComments,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { RackImage } from '../../components/rack_image'
import { t, tp } from '../../i18n'
import { formFactorLabel } from '../../i18n/labels'
import { createRecord, createRowsFor } from '../../lib/resource'
import { recordCrumb } from '../../lib/trails'

/** /rack-types/:id — rack type detail: specification and the racks of this type. */
export function RackTypeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [rackType] = createRecord(id, fetch_rack_type, setError)
	const manufacturerId = (): number | undefined => rackType()?.manufacturer_id
	const [manufacturer] = createRecord(manufacturerId, fetch_manufacturer, setError)
	const [racks] = createRowsFor(id, (key: number) => fetch_racks({ rack_type: [key] }), setError)

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
				crumbs={recordCrumb(manufacturer(), '/manufacturers')}
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
								<RecordLink
									id={manufacturerId()}
									record={manufacturer}
									base="/manufacturers"
								/>
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
					<SpecSheetComments text={rackType()?.comments} />
				</section>
			</DetailShell>

			<Show when={rackType()}>
				{(type: () => RackTypeRow): JSX.Element => (
					<section class="component-section" id="rack-type-elevation">
						<div class="card-header">
							<h3>{t('rackType.elevation')}</h3>
						</div>
						<RackImage u_height={type().u_height} form_factor={type().form_factor} />
					</section>
				)}
			</Show>

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
