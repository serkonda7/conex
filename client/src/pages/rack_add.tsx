import { IconPlus } from '@tabler/icons-solidjs'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, Show } from 'solid-js'
import { create_rack } from '../api_racks'
import { fetch_device_types, fetch_manufacturers, type ManufacturerRow } from '../api_templates'
import { fetch_locations, fetch_sites, fetch_tenants, type SiteRow } from '../api_tenancy'
import {
	FormActions,
	FormError,
	FormPage,
	Hint,
	NameField,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { navigate, parseId, queryParam } from '../router'
import { type FormValues, is_add_another_submit, load_rows, submit_form } from '../util/form'

/** Id of the hint under the rack-type select. */
const RACK_TYPE_HINT_ID = 'rack-type-hint'

/** /racks/add — NetBox-style rack create form. */
export function RackAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [locationId, setLocationId] = createSignal(queryParam('location'))
	const [tenantId, setTenantId] = createSignal(queryParam('tenant'))
	const [tenantTouched, setTenantTouched] = createSignal(queryParam('tenant') !== '')
	const [description, setDescription] = createSignal('')
	const [rackTypeId, setRackTypeId] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [sites] = createResource(() => load_rows(fetch_sites, setFormError))
	const [tenants] = createResource(() => load_rows(fetch_tenants, setFormError))
	const [rackTypes] = createResource(() =>
		load_rows(() => fetch_device_types({ kind: 'rack' }), setFormError),
	)
	const [manufacturers] = createResource(() => load_rows(fetch_manufacturers, setFormError))

	function manufacturerName(id: number): string {
		return (
			(manufacturers() ?? []).find((manufacturer: ManufacturerRow) => manufacturer.id === id)
				?.name ?? ''
		)
	}

	// Tenant defaults to the selected site's tenant until the user picks one
	// explicitly (or `?tenant=` is present, which counts as explicit).
	const siteTenantId = createMemo(() => {
		const id = parseId(siteId())
		if (id === null) {
			return null
		}
		return (sites() ?? []).find((site: SiteRow) => site.id === id)?.tenant_id ?? null
	})

	createEffect(() => {
		if (tenantTouched() || sites() === undefined) {
			return
		}
		const tenant = siteTenantId()
		setTenantId(tenant ? String(tenant) : '')
	})

	// Location options belong to a site, so they follow the site picker.
	const [locations] = createResource(siteId, async (site: string) => {
		const id = parseId(site)
		if (id === null) {
			return []
		}
		return load_rows(() => fetch_locations({ site: id }), setFormError)
	})

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setLocationId('')
	}

	function handleTenantChange(value: string): void {
		setTenantTouched(true)
		setTenantId(value)
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: name(),
			validate: () =>
				parseId(siteId()) === null
					? t('location.selectSiteFirst')
					: parseId(rackTypeId()) === null
						? t('rack.selectRackType')
						: null,
			save: (values: FormValues) =>
				create_rack({
					name: values.name,
					site_id: Number(siteId()),
					location_id: locationId() ? Number(locationId()) : null,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					rack_type_id: Number(rackTypeId()),
					description: description().trim() || undefined,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/racks',
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	return (
		<FormPage
			backTo="/racks"
			backLabel={tp('entity.rack', 2)}
			title={t('rack.addTitle')}
			onSubmit={handleCreate}
		>
			<SelectField
				id="rack-site"
				label={tp('entity.site', 1)}
				required
				value={siteId()}
				onChange={handleSiteChange}
				options={row_options(sites() ?? [])}
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
				hint={
					<Show when={siteId() === ''}>
						<Hint>{t('rack.pickSiteForLocation')}</Hint>
					</Show>
				}
			/>
			<NameField id="rack-name" placeholder="A1" value={name()} onInput={setName} autofocus />
			<SelectField
				id="rack-type"
				label={tp('entity.rackType', 1)}
				value={rackTypeId()}
				onChange={setRackTypeId}
				options={(rackTypes() ?? []).map((type) => ({
					value: type.id,
					label: `${type.model} (${manufacturerName(type.manufacturer_id)})`,
				}))}
				emptyLabel={t('rack.rackTypePlaceholder')}
				required
				describedBy={RACK_TYPE_HINT_ID}
				action={
					<button
						type="button"
						class="icon-btn btn-add"
						aria-label={t('app.navAdd', { label: tp('entity.rackType', 1) })}
						title={t('app.navAdd', { label: tp('entity.rackType', 1) })}
						onClick={() => navigate('/rack-types/add')}
					>
						<IconPlus size={16} />
					</button>
				}
			/>
			<TextField
				id="rack-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<SelectField
				id="rack-tenant"
				label={tp('entity.tenant', 1)}
				value={tenantId()}
				onChange={handleTenantChange}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
				hint={
					<Show when={!tenantTouched() && siteTenantId() !== null}>
						<Hint>{t('location.tenantFromSite')}</Hint>
					</Show>
				}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/racks" />
		</FormPage>
	)
}
