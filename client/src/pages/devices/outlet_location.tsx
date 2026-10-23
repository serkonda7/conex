import type { JSX } from 'solid-js'
import { createMemo } from 'solid-js'
import type { InterfaceJson } from '../../api/devices'
import { fetch_locations, fetch_sites } from '../../api/tenancy'
import { type FormOption, SelectField } from '../../components/form'
import { treePaths } from '../../components/tree_name'
import { t, tp } from '../../i18n'
import { createRows, type ErrorSink } from '../../lib/resource'

/** Outlet: a single-position rear port (a multi-position one is a trunk). */
export const isOutlet = (iface: InterfaceJson): boolean =>
	iface.side === 'rear' && iface.positions === 1

/**
 * Locations an outlet of a panel with `tenant` may lie in, labelled
 * `Site › Parent > Child`: any site, shared locations and the panel's
 * tenant's (any tenant's for a shared panel).
 */
export function useOutletLocationOptions(
	tenant: () => number | null | undefined,
	onError?: ErrorSink,
): () => FormOption[] {
	const [locations] = createRows(() => fetch_locations(), onError)
	const [sites] = createRows(() => fetch_sites(), onError)
	return createMemo(() => {
		const all = locations() ?? []
		const paths = treePaths(all)
		const siteNames = new Map((sites() ?? []).map((site) => [site.id, site.name]))
		const panelTenant = tenant() ?? null
		return all
			.filter(
				(l) => l.tenant_id === null || panelTenant === null || l.tenant_id === panelTenant,
			)
			.map((l) => ({
				value: String(l.id),
				label: `${siteNames.get(l.site_id) ?? ''} › ${paths.get(l.id) ?? l.name}`,
			}))
			.sort((a, b) => a.label.localeCompare(b.label))
	})
}

/** Location select of an outlet; `''` is no location. */
export function OutletLocationField(props: {
	id: string
	value: string
	onChange: (value: string) => void
	options: FormOption[]
	autofocus?: boolean
}): JSX.Element {
	return (
		<SelectField
			id={props.id}
			label={tp('entity.location', 1)}
			value={props.value}
			onChange={props.onChange}
			options={props.options}
			emptyLabel={t('device.outletLocation.none')}
			autofocus={props.autofocus}
		/>
	)
}
