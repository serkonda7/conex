import { type JSX, Show } from 'solid-js'
import type { DeviceListDevice } from '../../api/devices'
import type { DataTableColumn } from '../../components/data_table'
import { t, tp } from '../../i18n'

/** Tenant and site / rack columns of a related-devices table. */
export function devicePlacementColumns(names: {
	tenantName: (id: number) => string
	siteName: (id: number) => string
	rackName: (id: number) => string
}): DataTableColumn<DeviceListDevice>[] {
	return [
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<Show when={d.tenant_id} fallback="—">
					{(tenant: () => number) => (
						<a href={`/tenants/${tenant()}`}>{names.tenantName(tenant())}</a>
					)}
				</Show>
			),
		},
		{
			key: 'site',
			label: t('tenant.siteRack'),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<Show when={d.site_id !== null || d.rack_id !== null} fallback="—">
					<Show when={d.site_id}>
						{(site: () => number) => (
							<a href={`/sites/${site()}`}>{names.siteName(site())}</a>
						)}
					</Show>
					<Show when={d.site_id !== null && d.rack_id !== null}> / </Show>
					<Show when={d.rack_id}>
						{(rack: () => number) => (
							<a href={`/racks/${rack()}`}>
								{d.position_u === null
									? names.rackName(rack())
									: t('device.mountPosition', {
											rack: names.rackName(rack()),
											u: d.position_u,
										})}
							</a>
						)}
					</Show>
				</Show>
			),
		},
	]
}
