import { IconPlus } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { DeviceFace } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, Show } from 'solid-js'
import { create_device } from '../api_devices'
import { fetch_racks } from '../api_racks'
import { fetch_shelf } from '../api_shelves'
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
import { faceOptions } from '../i18n/labels'
import { navigate, parseId, queryParam } from '../router'
import { type FormValues, is_add_another_submit, load_rows, submit_form } from '../util/form'

/** /devices/add — NetBox-style device instantiate form. */
export function DeviceAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [typeId, setTypeId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [serial, setSerial] = createSignal('')
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [locationId, setLocationId] = createSignal(queryParam('location'))
	// Rack-install deep link (`/devices/add?rack=<id>&position_u=<u>&face=front`)
	// from the rack elevation pre-fills the mount so the U picker flows
	// straight into instantiation.
	const [rackId, setRackId] = createSignal(queryParam('rack'))
	const [face, setFace] = createSignal(
		queryParam('face') === 'front' || queryParam('face') === 'rear' ? queryParam('face') : '',
	)
	const [positionU, setPositionU] = createSignal(queryParam('position_u'))
	// Shelf deep link (`/devices/add?rack=<id>&shelf=<id>`) places the device
	// on that shelf: the rack follows the shelf and there is no U position.
	const shelfId = parseId(queryParam('shelf'))
	const [shelf] = createResource(
		() => shelfId,
		async (id: number) => {
			const res = await fetch_shelf(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			return res.value
		},
	)
	const [tenantId, setTenantId] = createSignal(queryParam('tenant'))
	const [tenantTouched, setTenantTouched] = createSignal(queryParam('tenant') !== '')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [types] = createResource(() => load_rows(fetch_device_types, setFormError))
	const [manufacturers] = createResource(() => load_rows(fetch_manufacturers, setFormError))
	const [sites] = createResource(() => load_rows(fetch_sites, setFormError))
	const [racks] = createResource(() => load_rows(fetch_racks, setFormError))
	const [tenants] = createResource(() => load_rows(fetch_tenants, setFormError))

	function manufacturerName(id: number): string {
		return (
			(manufacturers() ?? []).find((manufacturer: ManufacturerRow) => manufacturer.id === id)
				?.name ?? ''
		)
	}

	// Tenant defaults to the selected site's tenant until the user picks one
	// explicitly (or `?tenant=` is present, which counts as explicit).
	const siteTenantId = createMemo(() => {
		const id = Number(siteId())
		if (!siteId() || !Number.isInteger(id)) {
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

	// Locations belong to a site, so the options follow the site picker.
	const [locations] = createResource(siteId, async (site: string) => {
		const id = Number(site)
		if (!site || !Number.isInteger(id)) {
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

	function handleRackChange(value: string): void {
		setRackId(value)
		if (value === '') {
			setFace('')
		}
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const position = positionU().trim() === '' ? null : Number(positionU())
		await submit_form({
			name: name(),
			validate: (): string | null => {
				if (!typeId()) {
					return t('device.selectTypeFirst')
				}
				if (position !== null && (!Number.isInteger(position) || position < 1)) {
					return t('device.positionInvalid')
				}
				return null
			},
			save: (values: FormValues) =>
				create_device({
					device_type_id: Number(typeId()),
					name: values.name,
					description: description().trim() === '' ? undefined : description().trim(),
					serial: serial().trim() === '' ? undefined : serial().trim(),
					site_id: siteId() ? Number(siteId()) : null,
					location_id: locationId() ? Number(locationId()) : null,
					rack_id: rackId() ? Number(rackId()) : null,
					face: shelfId === null ? ((face() || null) as DeviceFace | null) : null,
					position_u: shelfId === null ? position : null,
					shelf_id: shelfId,
					tenant_id: tenantId() ? Number(tenantId()) : null,
				}),
			setError: setFormError,
			setSaving,
			// Elevation deep links return to the rack they came from.
			navigateTo:
				rackId() && queryParam('rack') === rackId() ? `/racks/${rackId()}` : '/devices',
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	return (
		<FormPage title={t('device.addTitle')} onSubmit={handleCreate}>
			<NameField
				id="device-name"
				placeholder={t('device.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus
			/>
			<SelectField
				id="device-type"
				label={tp('entity.deviceType', 1)}
				required
				value={typeId()}
				onChange={setTypeId}
				options={(types() ?? []).map((type) => ({
					value: type.id,
					label: `${type.model} (${manufacturerName(type.manufacturer_id)})`,
				}))}
				emptyLabel={t('device.deviceTypePlaceholder')}
				action={
					<button
						type="button"
						class="icon-btn btn-add"
						aria-label={t('app.navAdd', { label: tp('entity.deviceType', 1) })}
						title={t('app.navAdd', { label: tp('entity.deviceType', 1) })}
						onClick={() => navigate('/device-types/add')}
					>
						<IconPlus size={16} />
					</button>
				}
			/>
			<TextField
				id="device-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextField
				id="device-serial"
				label={t('device.serial')}
				placeholder={t('device.serialPlaceholder')}
				maxLength={100}
				value={serial()}
				onInput={setSerial}
			/>
			<SelectField
				id="device-site"
				label={tp('entity.site', 1)}
				value={siteId()}
				onChange={handleSiteChange}
				options={row_options(sites() ?? [])}
				emptyLabel={t('device.noSite')}
			/>
			<SelectField
				id="device-location"
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
			<SelectField
				id="device-rack"
				label={tp('entity.rack', 1)}
				value={rackId()}
				disabled={shelfId !== null}
				onChange={handleRackChange}
				options={row_options(racks() ?? [])}
				emptyLabel={t('device.unrackedOption')}
			/>
			<SelectField
				id="device-face"
				label={t('shelf.face')}
				value={face()}
				disabled={rackId() === '' || shelfId !== null}
				onChange={setFace}
				options={faceOptions()}
				emptyLabel={t('device.noFace')}
				hint={
					<Show when={rackId() === ''} fallback={<Hint>{t('device.faceHint')}</Hint>}>
						<Hint>{t('shelf.pickRackForFace')}</Hint>
					</Show>
				}
			/>
			<TextField
				id="device-position"
				label={t('common.position')}
				placeholder={t('device.positionPlaceholder')}
				inputmode="numeric"
				value={positionU()}
				onInput={setPositionU}
				hint={
					<Show
						when={shelfId !== null}
						fallback={<Hint>{t('device.positionHint')}</Hint>}
					>
						<Hint>
							{t('device.onShelfHint', {
								name:
									shelf()?.name ||
									t('common.unitPosition', { u: shelf()?.position_u ?? '' }),
							})}
						</Hint>
					</Show>
				}
			/>
			<SelectField
				id="device-tenant"
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
			<FormActions saving={saving()} cancelTo="/devices" />
		</FormPage>
	)
}
