import { IconPlus } from '@tabler/icons-solidjs'
import type { JSX } from 'solid-js'
import { createEffect, createMemo, createResource, createSignal, Show } from 'solid-js'
import { fetch_locations, fetch_sites, fetch_tenants, type SiteRow } from '../api_p1'
import { fetch_racks } from '../api_p2'
import { fetch_device_types } from '../api_p3'
import { create_device } from '../api_p4'
import {
	FormActions,
	FormError,
	type FormOption,
	FormPage,
	Hint,
	NameField,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { navigate, parseId, queryParam } from '../router'
import { type FormValues, is_add_another_submit, load_rows, submit_form } from '../util/form'

/** Rack faces a device can be mounted on. */
const FACE_OPTIONS: FormOption[] = [
	{ value: 'front', label: 'front' },
	{ value: 'rear', label: 'rear' },
]

/** /devices/add — NetBox-style device instantiate form. */
export function DeviceAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [typeId, setTypeId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [serial, setSerial] = createSignal('')
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [locationId, setLocationId] = createSignal('')
	// Rack-install deep link (`/devices/add?rack=<id>&position_u=<u>&face=front`)
	// from the rack elevation pre-fills the mount so the U picker flows
	// straight into instantiation.
	const [rackId, setRackId] = createSignal(queryParam('rack'))
	const [face, setFace] = createSignal(
		queryParam('face') === 'front' || queryParam('face') === 'rear' ? queryParam('face') : '',
	)
	const [positionU, setPositionU] = createSignal(queryParam('position_u'))
	const [tenantId, setTenantId] = createSignal(queryParam('tenant'))
	const [tenantTouched, setTenantTouched] = createSignal(queryParam('tenant') !== '')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [types] = createResource(() => load_rows(fetch_device_types, setFormError))
	const [sites] = createResource(() => load_rows(fetch_sites, setFormError))
	const [racks] = createResource(() => load_rows(fetch_racks, setFormError))
	const [tenants] = createResource(() => load_rows(fetch_tenants, setFormError))

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

	// Locations belong to a site, so the options follow the site picker.
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
					return 'Select a device type first.'
				}
				if (position !== null && (!Number.isInteger(position) || position < 1)) {
					return 'Rack position must be a positive U number or empty.'
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
					face: (face() || null) as 'front' | 'rear' | null,
					position_u: position,
					tenant_id: tenantId() ? Number(tenantId()) : null,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/devices',
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	return (
		<FormPage
			backTo="/devices"
			backLabel="Devices"
			title="Add a new device"
			onSubmit={handleCreate}
		>
			<NameField
				id="device-name"
				placeholder="sw-access-01"
				value={name()}
				onInput={setName}
				autofocus
			/>
			<SelectField
				id="device-type"
				label="Device type"
				required
				value={typeId()}
				onChange={setTypeId}
				options={(types() ?? []).map((t) => ({
					value: t.id,
					label: `${t.model} (${t.u_height}U)`,
				}))}
				emptyLabel="Device type…"
				action={
					<button
						type="button"
						class="icon-btn btn-add"
						aria-label="Add device type"
						title="Add device type"
						onClick={() => navigate('/device-types/add')}
					>
						<IconPlus size={16} />
					</button>
				}
			/>
			<TextField
				id="device-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextField
				id="device-serial"
				label="Serial"
				placeholder="Serial (optional)"
				maxLength={100}
				value={serial()}
				onInput={setSerial}
			/>
			<SelectField
				id="device-site"
				label="Site"
				value={siteId()}
				onChange={handleSiteChange}
				options={row_options(sites() ?? [])}
				emptyLabel="No site"
			/>
			<SelectField
				id="device-location"
				label="Location"
				value={locationId()}
				disabled={siteId() === ''}
				onChange={setLocationId}
				options={row_options(locations() ?? [])}
				emptyLabel="No location"
				hint={
					<Show when={siteId() === ''}>
						<Hint>Pick a site first to choose a location.</Hint>
					</Show>
				}
			/>
			<SelectField
				id="device-rack"
				label="Rack"
				value={rackId()}
				onChange={handleRackChange}
				options={row_options(racks() ?? [])}
				emptyLabel="Unracked"
			/>
			<SelectField
				id="device-face"
				label="Face"
				value={face()}
				disabled={rackId() === ''}
				onChange={setFace}
				options={FACE_OPTIONS}
				emptyLabel="No face"
				hint={
					<Show
						when={rackId() === ''}
						fallback={<Hint>Which rack face the device is mounted on.</Hint>}
					>
						<Hint>Pick a rack first to choose a face.</Hint>
					</Show>
				}
			/>
			<TextField
				id="device-position"
				label="U position"
				placeholder="U position (or empty)"
				inputmode="numeric"
				value={positionU()}
				onInput={setPositionU}
			/>
			<SelectField
				id="device-tenant"
				label="Tenant"
				value={tenantId()}
				onChange={handleTenantChange}
				options={row_options(tenants() ?? [])}
				emptyLabel="No tenant"
				hint={
					<Show when={!tenantTouched() && siteTenantId() !== null}>
						<Hint>Defaults to the site's tenant.</Hint>
					</Show>
				}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/devices" />
		</FormPage>
	)
}
