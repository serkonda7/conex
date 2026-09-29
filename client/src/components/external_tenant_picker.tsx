import type { Result } from 'better-result'
import type { JSX } from 'solid-js'
import {
	type ExternalTenantListItem,
	fetch_external_tenants,
	type IntegrationProvider,
} from '../api_integrations'
import { t } from '../i18n'
import { providerLabel } from '../i18n/labels'
import { ObjectSelector } from './object_selector'

interface PickerRow {
	id: number
	item: ExternalTenantListItem
}

function label(item: ExternalTenantListItem): string {
	const parts = [item.name]
	if (item.display_id !== null) {
		parts.push(`(${item.display_id})`)
	}
	if (!item.active) {
		parts.push(`· ${t('integration.inactive')}`)
	}
	if (item.linked_tenant_id !== null) {
		parts.push(`· ${t('integration.alreadyLinked')}`)
	}
	return parts.join(' ')
}

/**
 * Searchable picker over the synced external tenants (TANSS companies incl.
 * branches). Picking a company already linked elsewhere moves the link.
 */
export function ExternalTenantPicker(props: {
	provider: IntegrationProvider
	on_select: (item: ExternalTenantListItem) => void
	on_close: () => void
}): JSX.Element {
	async function load(search: string): Promise<Result<PickerRow[], Error>> {
		const res = await fetch_external_tenants(props.provider, search)
		// The selector shows `#id`: use the external id when it is numeric (TANSS).
		return res.map((items) =>
			items.map((item, index) => {
				const numeric = Number(item.external_id)
				return { id: Number.isInteger(numeric) ? numeric : index + 1, item }
			}),
		)
	}

	return (
		<ObjectSelector
			label={t('integration.pickTenant', { provider: providerLabel(props.provider) })}
			placeholder={t('integration.searchTenants')}
			load={load}
			get_label={(row: PickerRow): string => label(row.item)}
			on_select={(row: PickerRow) => props.on_select(row.item)}
			on_close={props.on_close}
		/>
	)
}
