import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import { type DeviceListDevice, fetch_device_list } from '../../api/devices'
import { fetch_racks } from '../../api/racks'
import {
	type DeviceTypeListRow,
	delete_manufacturer,
	fetch_device_types,
	fetch_manufacturer,
	fetch_rack_types,
	type RackTypeListRow,
} from '../../api/templates'
import { fetch_sites, fetch_tenants } from '../../api/tenancy'
import type { DataTableColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RelatedPreview,
	type RelatedTab,
	RelatedTabs,
	useDetailDelete,
} from '../../components/detail_page'
import { InlineError } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { Markdown } from '../../components/markdown'
import { ScrollLink } from '../../components/scroll_link'
import { t, tp } from '../../i18n'
import { deviceRoleLabel, formFactorLabel } from '../../i18n/labels'
import { deviceRoleIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRecord, createRows, createRowsFor } from '../../lib/resource'
import { formatDate, isPastEol } from '../../lib/time'
import { EolPill } from '../device_types/eol_pill'
import { SpecLink } from '../device_types/spec_link'
import { devicePlacementColumns } from '../devices/placement_columns'

/** Rows of the device tab; the "View all" link leads to the rest. */
const DEVICE_PREVIEW_LIMIT = 5

/** Date cell; a passed EOL date gets a warning badge. */
function EolDate(props: { date: string | null }): JSX.Element {
	return (
		<Show when={props.date} fallback="—">
			{(date: () => string): JSX.Element => (
				<Show when={isPastEol(date())} fallback={formatDate(date())}>
					<span class="badge badge-warning">{formatDate(date())}</span>
				</Show>
			)}
		</Show>
	)
}

/**
 * /manufacturers/:id — manufacturer detail: spec sheet (contact, catalog,
 * usage, comments) and tabs with its device types, rack types and devices.
 */
export function ManufacturerDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [activeTab, setActiveTab] = createSignal<string | null>(null)
	const id = (): number => props.id
	const [manufacturer] = createRecord(id, fetch_manufacturer, setError)
	const [deviceTypes] = createRowsFor(
		id,
		(key: number) =>
			fetch_device_types({ manufacturer: [key], sort: 'devices', order: 'desc' }),
		setError,
	)
	const [rackTypes] = createRowsFor(
		id,
		(key: number) => fetch_rack_types({ manufacturer: [key] }),
		setError,
	)
	const [devices] = createRowsFor(
		id,
		(key: number) =>
			fetch_device_list({ manufacturer: key, kind: 'device', limit: DEVICE_PREVIEW_LIMIT }),
		setError,
	)
	const [roles] = createRows(fetch_device_roles, setError)
	const [tenants] = createRows(fetch_tenants, setError)
	const [sites] = createRows(fetch_sites, setError)
	const [racks] = createRows(fetch_racks, setError)
	const roleName = useNameOf(roles, deviceRoleLabel)
	const roleIcon = (roleId: number): ReturnType<typeof deviceRoleIcon> =>
		deviceRoleIcon(roles()?.find((r) => r.id === roleId)?.icon)
	const typeName = useNameOf(deviceTypes, (type) => type.model)
	const tenantName = useNameOf(tenants)
	const siteName = useNameOf(sites)
	const rackName = useNameOf(racks)

	const handleDelete = useDetailDelete({
		noun: 'noun.manufacturer',
		name: () => manufacturer()?.name,
		id: props.id,
		remove: delete_manufacturer,
		setError,
		listRoute: '/manufacturers',
	})

	const deviceTypeColumns: DataTableColumn<DeviceTypeListRow>[] = [
		{
			key: 'model',
			label: t('common.model'),
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<a href={`/device-types/${dt.id}`}>{dt.model}</a>
			),
		},
		{
			key: 'part_number',
			label: t('deviceType.partNumber'),
			getValue: (dt: DeviceTypeListRow): string => dt.part_number || '—',
		},
		{
			key: 'role',
			label: t('deviceType.defaultRole'),
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<Show when={dt.default_device_role_id} fallback="—">
					{(role: () => number): JSX.Element => (
						<a href={`/device-roles/${role()}`}>
							<IconLabel icon={roleIcon(role())}>{roleName(role())}</IconLabel>
						</a>
					)}
				</Show>
			),
		},
		{
			key: 'u_height',
			label: t('common.heightU'),
			getValue: (dt: DeviceTypeListRow): string => `${dt.u_height}`,
		},
		{
			key: 'eol_date',
			label: t('deviceType.eolDate'),
			getValue: (dt: DeviceTypeListRow): JSX.Element => <EolDate date={dt.eol_date} />,
		},
		{
			key: 'devices',
			label: tp('entity.device', 2),
			getValue: (dt: DeviceTypeListRow): JSX.Element => (
				<a href={`/devices?device_type=${dt.id}`}>{dt.instance_count}</a>
			),
		},
	]

	const rackTypeColumns: DataTableColumn<RackTypeListRow>[] = [
		{
			key: 'model',
			label: t('common.model'),
			getValue: (rt: RackTypeListRow): JSX.Element => (
				<a href={`/rack-types/${rt.id}`}>{rt.model}</a>
			),
		},
		{
			key: 'form_factor',
			label: t('rackType.formFactor'),
			getValue: (rt: RackTypeListRow): string => formFactorLabel(rt.form_factor),
		},
		{
			key: 'u_height',
			label: t('common.heightU'),
			getValue: (rt: RackTypeListRow): string => `${rt.u_height}`,
		},
		{
			key: 'racks',
			label: tp('entity.rack', 2),
			getValue: (rt: RackTypeListRow): JSX.Element => (
				<a href={`/racks?rack_type=${rt.id}`}>{rt.instance_count}</a>
			),
		},
	]

	const eolDate = (d: DeviceListDevice): string | null | undefined =>
		deviceTypes()?.find((type) => type.id === d.device_type_id)?.eol_date

	const deviceColumns: DataTableColumn<DeviceListDevice>[] = [
		{
			key: 'name',
			label: t('common.name'),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<>
					<a href={`/devices/${d.id}`}>{d.name}</a> <EolPill date={eolDate(d)} />
				</>
			),
		},
		{
			key: 'device_type',
			label: tp('entity.deviceType', 1),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<a href={`/device-types/${d.device_type_id}`}>{typeName(d.device_type_id)}</a>
			),
		},
		...devicePlacementColumns({ tenantName, siteName, rackName }),
	]

	const tabs = (): RelatedTab[] => [
		{
			key: 'device-types',
			label: tp('entity.deviceType', 2),
			count: manufacturer()?.device_type_count ?? 0,
			viewAllHref: `/device-types?manufacturer=${props.id}`,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={deviceTypes() ?? []}
					loading={deviceTypes.loading}
					noun="noun.deviceType"
					emptyText={t('manufacturer.noDeviceTypes')}
					columns={deviceTypeColumns}
				/>
			),
		},
		{
			key: 'rack-types',
			label: tp('entity.rackType', 2),
			count: manufacturer()?.rack_type_count ?? 0,
			viewAllHref: `/rack-types?manufacturer=${props.id}`,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={rackTypes() ?? []}
					loading={rackTypes.loading}
					noun="noun.rackType"
					emptyText={t('manufacturer.noRackTypes')}
					columns={rackTypeColumns}
				/>
			),
		},
		{
			key: 'devices',
			label: tp('entity.device', 2),
			count: manufacturer()?.device_count ?? 0,
			viewAllHref: `/devices?manufacturer=${props.id}&kind=device`,
			content: (): JSX.Element => (
				<RelatedPreview
					rows={(devices() ?? []).filter(
						(d): d is DeviceListDevice => d.kind === 'device',
					)}
					loading={devices.loading}
					noun="noun.device"
					emptyText={t('manufacturer.noDevices')}
					columns={deviceColumns}
				/>
			),
		},
	]

	return (
		<div>
			<DetailShell
				name={manufacturer()?.name}
				record={manufacturer}
				loadingText={t('manufacturer.loadingOne')}
				emptyText={t('manufacturer.notFound')}
			>
				<DetailHeader
					name={manufacturer()?.name}
					editHref={`/manufacturers/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={manufacturer()?.description} />

				<section class="spec-sheet" aria-label={t('manufacturer.details')}>
					<section>
						<h4>{t('manufacturer.section.contact')}</h4>
						<dl>
							<dt>{t('manufacturer.website')}</dt>
							<dd>
								<Show when={manufacturer()?.website} fallback="—">
									{(url: () => string): JSX.Element => <SpecLink url={url()} />}
								</Show>
							</dd>
							<dt>{t('manufacturer.supportUrl')}</dt>
							<dd>
								<Show when={manufacturer()?.support_url} fallback="—">
									{(url: () => string): JSX.Element => <SpecLink url={url()} />}
								</Show>
							</dd>
						</dl>
					</section>
					<section>
						<h4>{t('manufacturer.section.catalog')}</h4>
						<dl>
							<dt>{tp('entity.deviceType', 2)}</dt>
							<dd>
								<ScrollLink
									target="manufacturer-related"
									onFollow={() => setActiveTab('device-types')}
								>
									{manufacturer()?.device_type_count}
								</ScrollLink>
							</dd>
							<dt>{tp('entity.rackType', 2)}</dt>
							<dd>
								<ScrollLink
									target="manufacturer-related"
									onFollow={() => setActiveTab('rack-types')}
								>
									{manufacturer()?.rack_type_count}
								</ScrollLink>
							</dd>
						</dl>
					</section>
					<section>
						<h4>{t('deviceType.section.usage')}</h4>
						<dl>
							<dt>{tp('entity.device', 2)}</dt>
							<dd>
								<ScrollLink
									target="manufacturer-related"
									onFollow={() => setActiveTab('devices')}
								>
									{manufacturer()?.device_count}
								</ScrollLink>
							</dd>
							<dt>{t('manufacturer.pastEol')}</dt>
							<dd>
								<Show when={(manufacturer()?.past_eol_count ?? 0) > 0} fallback="0">
									<a
										class="badge badge-warning"
										href={`/devices?manufacturer=${props.id}&past_eol=true`}
									>
										{tp(
											'manufacturer.pastEolDevices',
											manufacturer()?.past_eol_count ?? 0,
										)}
									</a>
								</Show>
							</dd>
						</dl>
					</section>
					<Show when={manufacturer()?.comments}>
						<section class="spec-sheet-notes">
							<h4>{t('common.comments')}</h4>
							<Markdown text={manufacturer()?.comments} />
						</section>
					</Show>
				</section>

				<RelatedTabs
					id="manufacturer-related"
					label={t('manufacturer.related')}
					tabs={tabs()}
					active={activeTab()}
					onActiveChange={setActiveTab}
				/>
			</DetailShell>

			<InlineError message={error()} />
		</div>
	)
}
