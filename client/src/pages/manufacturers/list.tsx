import { type JSX, Show } from 'solid-js'
import {
	delete_manufacturer,
	fetch_manufacturers,
	type ManufacturerListRow,
	type ManufacturerSort,
} from '../../api/templates'
import { descriptionColumn, nameColumn } from '../../components/data_table'
import { EntityListPage, useEntityList } from '../../components/list_page'
import { t, tp } from '../../i18n'
import { SpecLink } from '../device_types/spec_link'

/** Count cell linking to the related list; zero has nothing to show there. */
function CountLink(props: { count: number; href: string }): JSX.Element {
	return (
		<Show when={props.count > 0} fallback="0">
			<a href={props.href}>{props.count}</a>
		</Show>
	)
}

/**
 * /manufacturers — manufacturer list: search, sortable columns with the
 * catalog and usage counts, and icon actions with delete in a row menu.
 */
export function ManufacturersPage(): JSX.Element {
	const list = useEntityList({
		noun: 'noun.manufacturer',
		sort: 'name' as ManufacturerSort,
		fetch: fetch_manufacturers,
		remove: delete_manufacturer,
	})

	return (
		<EntityListPage
			list={list}
			title={tp('entity.manufacturer', 2)}
			addHref="/manufacturers/add"
			columns={[
				nameColumn<ManufacturerListRow>(t('common.name'), '/manufacturers', {
					sortable: true,
				}),
				descriptionColumn({ sortable: true }),
				{
					key: 'website',
					label: t('manufacturer.website'),
					sortable: true,
					getValue: (m: ManufacturerListRow): JSX.Element =>
						m.website ? <SpecLink url={m.website} /> : <span>—</span>,
				},
				{
					key: 'device_types',
					label: tp('entity.deviceType', 2),
					sortable: true,
					getValue: (m: ManufacturerListRow): JSX.Element => (
						<CountLink
							count={m.device_type_count}
							href={`/device-types?manufacturer=${m.id}`}
						/>
					),
				},
				{
					key: 'rack_types',
					label: tp('entity.rackType', 2),
					sortable: true,
					getValue: (m: ManufacturerListRow): JSX.Element => (
						<CountLink
							count={m.rack_type_count}
							href={`/rack-types?manufacturer=${m.id}`}
						/>
					),
				},
				{
					key: 'devices',
					label: tp('entity.device', 2),
					sortable: true,
					getValue: (m: ManufacturerListRow): JSX.Element => (
						<CountLink
							count={m.device_count}
							href={`/devices?manufacturer=${m.id}&kind=device`}
						/>
					),
				},
				{
					key: 'past_eol',
					label: t('manufacturer.pastEol'),
					sortable: true,
					getValue: (m: ManufacturerListRow): JSX.Element => (
						<Show when={m.past_eol_count > 0} fallback="0">
							<span class="badge badge-warning">{m.past_eol_count}</span>
						</Show>
					),
				},
			]}
			columnsKey="manufacturers"
			defaultColumns={[
				'name',
				'website',
				'device_types',
				'rack_types',
				'devices',
				'past_eol',
			]}
			rowName={(m: ManufacturerListRow): string => m.name}
			editHref={(m: ManufacturerListRow): string => `/manufacturers/${m.id}/edit`}
			emptyText={t('manufacturer.empty')}
		/>
	)
}
