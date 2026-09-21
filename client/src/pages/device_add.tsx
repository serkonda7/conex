import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import { fetch_locations, fetch_sites, fetch_tenants } from '../api_p1'
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
import { parseId } from '../router'
import { type FormValues, load_rows, submit_form } from '../util/form'

/** Rack faces a device can be mounted on. */
const FACE_OPTIONS: FormOption[] = [
	{ value: 'front', label: 'front' },
	{ value: 'rear', label: 'rear' },
]

/** Lifecycle states accepted by the device API. */
const STATUS_OPTIONS: FormOption[] = [
	{ value: 'active', label: 'active' },
	{ value: 'planned', label: 'planned' },
	{ value: 'staged', label: 'staged' },
	{ value: 'decommissioned', label: 'decommissioned' },
]

/** /devices/add — NetBox-style device instantiate form. */
export function DeviceAddPage(): JSX.Element {
	const [name, setName] = createSignal('')
	const [typeId, setTypeId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [serial, setSerial] = createSignal('')
	const [siteId, setSiteId] = createSignal('')
	const [locationId, setLocationId] = createSignal('')
	const [rackId, setRackId] = createSignal('')
	const [face, setFace] = createSignal('')
	const [positionU, setPositionU] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [status, setStatus] = createSignal('active')
	const [assetTag, setAssetTag] = createSignal('')
	const [shelfId, setShelfId] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [types] = createResource(() => load_rows(fetch_device_types, setFormError))
	const [sites] = createResource(() => load_rows(fetch_sites, setFormError))
	const [racks] = createResource(() => load_rows(fetch_racks, setFormError))
	const [tenants] = createResource(() => load_rows(fetch_tenants, setFormError))

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

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const position = positionU().trim() === '' ? null : Number(positionU())
		const shelf = shelfId().trim() === '' ? null : Number(shelfId().trim())
		await submit_form({
			name: name(),
			validate: (): string | null => {
				if (!typeId()) {
					return 'Select a device type first.'
				}
				if (position !== null && (!Number.isInteger(position) || position < 1)) {
					return 'Rack position must be a positive U number or empty.'
				}
				if (shelf !== null && (!Number.isInteger(shelf) || shelf < 1)) {
					return 'Shelf id must be a positive integer or empty.'
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
					shelf_id: shelf,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					status: status() as 'active' | 'planned' | 'staged' | 'decommissioned',
					asset_tag: assetTag().trim() === '' ? null : assetTag().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/devices',
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
				hint={
					<Hint>The template decides the U footprint and the expanded interfaces.</Hint>
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
				onChange={setRackId}
				options={row_options(racks() ?? [])}
				emptyLabel="Unracked"
			/>
			<SelectField
				id="device-face"
				label="Face"
				value={face()}
				onChange={setFace}
				options={FACE_OPTIONS}
				emptyLabel="No face"
				hint={<Hint>Which rack face the device is mounted on.</Hint>}
			/>
			<TextField
				id="device-position"
				label="U position"
				placeholder="U position (or empty)"
				inputmode="numeric"
				value={positionU()}
				onInput={setPositionU}
				hint={
					<Hint>
						Either a rack position or a shelf, never both. Leave both empty for an
						unracked device.
					</Hint>
				}
			/>
			<SelectField
				id="device-tenant"
				label="Tenant"
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel="No tenant"
			/>
			<SelectField
				id="device-status"
				label="Status"
				value={status()}
				onChange={setStatus}
				options={STATUS_OPTIONS}
			/>
			<TextField
				id="device-asset-tag"
				label="Asset tag"
				placeholder="Asset tag (optional)"
				maxLength={100}
				value={assetTag()}
				onInput={setAssetTag}
			/>
			<TextField
				id="device-shelf"
				label="Shelf id"
				placeholder="Shelf id (or empty)"
				inputmode="numeric"
				value={shelfId()}
				onInput={setShelfId}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/devices" />
		</FormPage>
	)
}
