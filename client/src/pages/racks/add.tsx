import { createSignal, type JSX, Show } from 'solid-js'
import { create_rack } from '../../api/racks'
import { fetch_locations, fetch_sites, fetch_tenants } from '../../api/tenancy'
import {
	DescriptionField,
	FormPage,
	Hint,
	NameField,
	row_options,
	SelectField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useFormState,
} from '../../lib/form'
import { createRows, createRowsFor } from '../../lib/resource'
import { parseId, queryParam } from '../../lib/router'
import { useSiteTenant } from '../../lib/tenant_context'
import { useDeviceTypeOptions } from '../device_types/options'

/** Id of the hint under the rack-type select. */
const RACK_TYPE_HINT_ID = 'rack-type-hint'

/** /racks/add — NetBox-style rack create form. */
export function RackAddPage(): JSX.Element {
	const form = useFormState()
	const [name, setName] = createSignal('')
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [locationId, setLocationId] = createSignal(queryParam('location'))
	const [description, setDescription] = createSignal('')
	const [rackTypeId, setRackTypeId] = createSignal('')

	const [sites] = createRows(fetch_sites, form.setError)
	const [tenants] = createRows(fetch_tenants, form.setError)
	const rackTypes = useDeviceTypeOptions({ kind: 'rack' }, form.setError)
	// Location options belong to a site, so they follow the site picker.
	const [locations] = createRowsFor(
		() => parseId(siteId()),
		(key: number) => fetch_locations({ site: key }),
		form.setError,
	)

	const { siteTenantId, siteOptions, tenant } = useSiteTenant(sites, siteId, () =>
		handleSiteChange(''),
	)

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setLocationId('')
	}

	function validate(): string | null {
		if (parseId(siteId()) === null) {
			return t('location.selectSiteFirst')
		}
		return parseId(rackTypeId()) === null ? t('rack.selectRackType') : null
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: name(),
			validate,
			save: (values: FormValues) =>
				create_rack({
					name: values.name,
					site_id: Number(siteId()),
					location_id: parseId(locationId()),
					tenant_id: parseId(tenant.value()),
					rack_type_id: Number(rackTypeId()),
					description: text(description()),
				}),
			navigateTo: '/racks',
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	return (
		<FormPage form={form} title={t('rack.addTitle')} cancelTo="/racks" onSubmit={handleCreate}>
			<SelectField
				id="rack-site"
				label={tp('entity.site', 1)}
				required
				value={siteId()}
				onChange={handleSiteChange}
				options={row_options(siteOptions())}
				emptyLabel={t('location.sitePlaceholder')}
			/>
			<SelectField
				id="rack-location"
				label={tp('entity.location', 1)}
				value={locationId()}
				disabled={siteId() === ''}
				onChange={setLocationId}
				options={row_options(locations() ?? [])}
				emptyLabel={t('rack.noLocation')}
			/>
			<NameField id="rack-name" placeholder="A1" value={name()} onInput={setName} autofocus />
			<SelectField
				id="rack-type"
				label={tp('entity.rackType', 1)}
				value={rackTypeId()}
				onChange={setRackTypeId}
				options={rackTypes.options()}
				emptyLabel={t('rack.rackTypePlaceholder')}
				required
				describedBy={RACK_TYPE_HINT_ID}
				add={{ label: tp('entity.rackType', 1), href: '/rack-types/add' }}
				reload={rackTypes.reload}
			/>
			<DescriptionField
				id="rack-description"
				value={description()}
				onInput={setDescription}
			/>
			<SelectField
				id="rack-tenant"
				label={tp('entity.tenant', 1)}
				value={tenant.value()}
				onChange={tenant.pick}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
				hint={
					<Show when={!tenant.touched() && siteTenantId() !== null}>
						<Hint>{t('location.tenantFromSite')}</Hint>
					</Show>
				}
			/>
		</FormPage>
	)
}
