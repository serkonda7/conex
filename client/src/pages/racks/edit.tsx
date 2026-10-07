import { createSignal, type JSX } from 'solid-js'
import { fetch_rack, type RackRow, update_rack } from '../../api/racks'
import { fetch_location, fetch_locations, fetch_site, fetch_tenants } from '../../api/tenancy'
import {
	DescriptionField,
	type FormOption,
	FormPage,
	NameField,
	ReadOnlyField,
	row_options,
	SelectField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { type FormValues, id_value, submit_form, text, useEntityForm } from '../../lib/form'
import { createRecord, createRows, createRowsFor } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { useDeviceTypeOptions } from '../device_types/options'

/** /racks/:id/edit — rack edit form. Saves back to the detail page. */
export function RackEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [locationId, setLocationId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [rackTypeId, setRackTypeId] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_rack,
		fill: (row: RackRow) => {
			setName(row.name)
			setLocationId(id_value(row.location_id))
			setTenantId(id_value(row.tenant_id))
			setDescription(row.description ?? '')
			setRackTypeId(String(row.rack_type_id))
		},
	})
	// The site is immutable; location options stay within it.
	const siteId = (): number | undefined => form.record()?.site_id
	const [tenants] = createRows(fetch_tenants, form.setError)
	const rackTypes = useDeviceTypeOptions({ kind: 'rack' }, form.setError)
	const [siblings] = createRowsFor(
		siteId,
		(key: number) => fetch_locations({ site: key }),
		form.setError,
	)
	const [site] = createRecord(siteId, fetch_site)
	const [currentLocation] = createRecord(() => parseId(locationId()), fetch_location)

	// Keep a current location that falls outside the sibling list selectable
	// so the combobox can still show it.
	function locationOptions(): FormOption[] {
		const options = row_options(siblings() ?? [])
		const current = currentLocation()
		if (current && locationId() !== '' && options.every((o) => o.value !== current.id)) {
			options.push({ value: current.id, label: current.name })
		}
		return options
	}

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: name(),
			save: (values: FormValues) =>
				update_rack(props.id, {
					name: values.name,
					rack_type_id: Number(rackTypeId()),
					location_id: parseId(locationId()),
					tenant_id: parseId(tenantId()),
					description: text(description()) ?? null,
				}),
			navigateTo: `/racks/${props.id}`,
		})
	}

	return (
		<FormPage
			form={form}
			title={t('rack.editTitle')}
			name={form.record()?.name}
			loadingText={t('rack.loadingOne')}
			cancelTo={`/racks/${props.id}`}
			onSubmit={handleSave}
		>
			<ReadOnlyField
				id="rack-edit-site"
				label={tp('entity.site', 1)}
				value={site()?.name ?? id_value(siteId())}
				hint={t('location.siteImmutable')}
			/>
			<SelectField
				id="rack-edit-location"
				label={tp('entity.location', 1)}
				value={locationId()}
				onChange={setLocationId}
				options={locationOptions()}
				emptyLabel={t('rack.noLocation')}
			/>
			<NameField id="rack-edit-name" placeholder="A1" value={name()} onInput={setName} />
			<DescriptionField
				id="rack-edit-description"
				value={description()}
				onInput={setDescription}
			/>
			<SelectField
				id="rack-edit-type"
				label={tp('entity.rackType', 1)}
				value={rackTypeId()}
				onChange={setRackTypeId}
				options={rackTypes.options()}
				required
			/>
			<SelectField
				id="rack-edit-tenant"
				label={tp('entity.tenant', 1)}
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
			/>
		</FormPage>
	)
}
