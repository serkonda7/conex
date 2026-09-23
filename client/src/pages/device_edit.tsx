import { Result } from 'better-result'
import type { DeviceFace } from 'shared/src/types'
import { createResource, createSignal, type JSX, Show } from 'solid-js'
import { fetch_device, update_device } from '../api_devices'
import { fetch_racks } from '../api_racks'
import { fetch_device_types } from '../api_templates'
import { fetch_locations, fetch_sites, fetch_tenants } from '../api_tenancy'
import {
	EditActions,
	EditPageShell,
	FormError,
	Hint,
	NameField,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /devices/:id/edit — device edit form. Saves back to the detail page. */
export function DeviceEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [serial, setSerial] = createSignal('')
	const [siteId, setSiteId] = createSignal('')
	const [locationId, setLocationId] = createSignal('')
	const [rackId, setRackId] = createSignal('')
	const [face, setFace] = createSignal('')
	const [positionU, setPositionU] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [sites] = createResource(async () => {
		const res = await fetch_sites()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})
	// Locations belong to a site, so the options follow the site picker.
	const [locations] = createResource(siteId, async (site: string) => {
		if (!site) {
			return []
		}
		const res = await fetch_locations(Number(site))
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [racks] = createResource(async () => {
		const res = await fetch_racks()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [types] = createResource(async () => {
		const res = await fetch_device_types()
		if (Result.isError(res)) {
			return []
		}
		return res.value.items
	})

	const typeName = (): string => {
		const id = device()?.device_type_id
		if (id === undefined) {
			return ''
		}
		return types()?.find((t) => t.id === id)?.model ?? String(id)
	}

	const [device] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_device(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setDescription(res.value.description ?? '')
			setSerial(res.value.serial ?? '')
			setSiteId(res.value.site_id ? String(res.value.site_id) : '')
			setLocationId(res.value.location_id ? String(res.value.location_id) : '')
			setRackId(res.value.rack_id ? String(res.value.rack_id) : '')
			setFace(res.value.face ?? '')
			setPositionU(res.value.position_u !== null ? String(res.value.position_u) : '')
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setLoaded(true)
			return res.value
		},
	)

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setLocationId('')
	}

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: name(),
			validate: () => {
				const position = positionU().trim() === '' ? null : Number(positionU())
				if (position !== null && (!Number.isInteger(position) || position < 1)) {
					return 'Rack position must be a positive U number or empty.'
				}
				return null
			},
			save: (values: FormValues) =>
				update_device(props.id, {
					name: values.name,
					description: description().trim() === '' ? null : description().trim(),
					serial: serial().trim() === '' ? null : serial().trim(),
					site_id: siteId() ? Number(siteId()) : null,
					location_id: locationId() ? Number(locationId()) : null,
					rack_id: rackId() ? Number(rackId()) : null,
					face: (face() || null) as DeviceFace | null,
					position_u: positionU().trim() === '' ? null : Number(positionU().trim()),
					tenant_id: tenantId() ? Number(tenantId()) : null,
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/devices/${props.id}`,
		})
	}

	return (
		<EditPageShell
			backTo={`/devices/${props.id}`}
			backLabel={device()?.name ?? 'Device'}
			title="Edit device"
			loaded={loaded()}
			loadingText="Loading device…"
			onSubmit={handleSave}
		>
			<NameField
				id="device-edit-name"
				placeholder="sw-access-01"
				value={name()}
				onInput={setName}
			/>
			<div class="field">
				<label for="device-edit-type">Device type</label>
				<input id="device-edit-type" value={typeName()} disabled />
				<p class="field-hint">
					The device type is immutable after create: swapping the template would
					invalidate the interfaces and the U footprint.
				</p>
			</div>
			<TextField
				id="device-edit-description"
				label="Description"
				placeholder="Short summary (optional)"
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextField
				id="device-edit-serial"
				label="Serial"
				placeholder="Serial (optional)"
				maxLength={100}
				value={serial()}
				onInput={setSerial}
			/>
			<SelectField
				id="device-edit-site"
				label="Site"
				value={siteId()}
				onChange={handleSiteChange}
				options={row_options(sites() ?? [])}
				emptyLabel="No site"
			/>
			<SelectField
				id="device-edit-location"
				label="Location"
				value={locationId()}
				onChange={setLocationId}
				options={row_options(locations() ?? [])}
				emptyLabel="No location"
				disabled={siteId() === ''}
				hint={
					<Show when={siteId() === ''}>
						<Hint>Pick a site first to choose a location.</Hint>
					</Show>
				}
			/>
			<SelectField
				id="device-edit-rack"
				label="Rack"
				value={rackId()}
				onChange={setRackId}
				options={row_options(racks() ?? [])}
				emptyLabel="Unracked"
			/>
			<SelectField
				id="device-edit-face"
				label="Face"
				value={face()}
				onChange={setFace}
				options={[
					{ value: 'front', label: 'front' },
					{ value: 'rear', label: 'rear' },
				]}
				emptyLabel="No face"
			/>
			<TextField
				id="device-edit-position"
				label="U position"
				placeholder="U position (empty clears)"
				inputmode="numeric"
				value={positionU()}
				onInput={setPositionU}
				hint={
					<Hint>
						Either a rack position or a shelf, never both. Empty both plus no rack to
						unrack the device.
					</Hint>
				}
			/>
			<SelectField
				id="device-edit-tenant"
				label="Tenant"
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel="No tenant"
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/devices/${props.id}`} />
		</EditPageShell>
	)
}
