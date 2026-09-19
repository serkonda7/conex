import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, onMount, Show } from 'solid-js'
import {
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type SiteRow,
	type TenantRow,
} from '../api_p1'
import { fetch_racks, type RackRow } from '../api_p2'
import { type DeviceTypeRow, fetch_device_types } from '../api_p3'
import { create_device } from '../api_p4'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

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
	let nameInput: HTMLInputElement | undefined

	const [types] = createResource(async () => {
		const res = await fetch_device_types()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})
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

	onMount(() => {
		nameInput?.focus()
	})

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setLocationId('')
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setFormError(null)
		const trimmedName = name().trim()
		if (!trimmedName) {
			setFormError('Name is required.')
			return
		}
		if (!typeId()) {
			setFormError('Select a device type first.')
			return
		}
		const position = positionU().trim() === '' ? null : Number(positionU())
		if (position !== null && (!Number.isInteger(position) || position < 1)) {
			setFormError('Rack position must be a positive U number or empty.')
			return
		}
		const shelf = shelfId().trim() === '' ? null : Number(shelfId().trim())
		if (shelf !== null && (!Number.isInteger(shelf) || shelf < 1)) {
			setFormError('Shelf id must be a positive integer or empty.')
			return
		}
		setSaving(true)
		const res = await create_device({
			device_type_id: Number(typeId()),
			name: trimmedName,
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
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/devices')
	}

	return (
		<div class="form-page">
			<p>
				<a href="/devices" onClick={(e: MouseEvent): void => go(e, '/devices')}>
					← Devices
				</a>
			</p>
			<h2>Add a new device</h2>
			<form class="form-stacked" onSubmit={handleCreate}>
				<div class="field">
					<label for="device-name">
						Name{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<input
						id="device-name"
						ref={nameInput}
						placeholder="sw-access-01"
						required
						maxLength={100}
						value={name()}
						onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="device-type">
						Device type{' '}
						<span class="required" aria-hidden="true">
							*
						</span>
					</label>
					<select
						id="device-type"
						required
						value={typeId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setTypeId(e.currentTarget.value)
						}
					>
						<option value="">Device type…</option>
						<For each={types() ?? []}>
							{(t: DeviceTypeRow): JSX.Element => (
								<option value={t.id}>
									{t.model} ({t.u_height}U)
								</option>
							)}
						</For>
					</select>
					<p class="field-hint">
						The template decides the U footprint and the expanded interfaces.
					</p>
				</div>
				<div class="field">
					<label for="device-description">Description</label>
					<input
						id="device-description"
						placeholder="Short summary (optional)"
						maxLength={500}
						value={description()}
						onInput={(e: InputEventAndTarget) => setDescription(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="device-serial">Serial</label>
					<input
						id="device-serial"
						placeholder="Serial (optional)"
						maxLength={100}
						value={serial()}
						onInput={(e: InputEventAndTarget) => setSerial(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="device-site">Site</label>
					<select
						id="device-site"
						value={siteId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							handleSiteChange(e.currentTarget.value)
						}
					>
						<option value="">No site</option>
						<For each={sites() ?? []}>
							{(s: SiteRow): JSX.Element => <option value={s.id}>{s.name}</option>}
						</For>
					</select>
				</div>
				<div class="field">
					<label for="device-location">Location</label>
					<select
						id="device-location"
						value={locationId()}
						disabled={siteId() === ''}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setLocationId(e.currentTarget.value)
						}
					>
						<option value="">No location</option>
						<For each={locations() ?? []}>
							{(l: LocationRow): JSX.Element => (
								<option value={l.id}>{l.name}</option>
							)}
						</For>
					</select>
					<Show when={siteId() === ''}>
						<p class="field-hint">Pick a site first to choose a location.</p>
					</Show>
				</div>
				<div class="field">
					<label for="device-rack">Rack</label>
					<select
						id="device-rack"
						value={rackId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setRackId(e.currentTarget.value)
						}
					>
						<option value="">Unracked</option>
						<For each={racks() ?? []}>
							{(r: RackRow): JSX.Element => <option value={r.id}>{r.name}</option>}
						</For>
					</select>
				</div>
				<div class="field">
					<label for="device-face">Face</label>
					<select
						id="device-face"
						value={face()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setFace(e.currentTarget.value)
						}
					>
						<option value="">No face</option>
						<option value="front">front</option>
						<option value="rear">rear</option>
					</select>
					<p class="field-hint">Which rack face the device is mounted on.</p>
				</div>
				<div class="field">
					<label for="device-position">U position</label>
					<input
						id="device-position"
						placeholder="U position (or empty)"
						inputmode="numeric"
						value={positionU()}
						onInput={(e: InputEventAndTarget) => setPositionU(e.currentTarget.value)}
					/>
					<p class="field-hint">
						Either a rack position or a shelf, never both. Leave both empty for an
						unracked device.
					</p>
				</div>
				<div class="field">
					<label for="device-tenant">Tenant</label>
					<select
						id="device-tenant"
						value={tenantId()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setTenantId(e.currentTarget.value)
						}
					>
						<option value="">No tenant</option>
						<For each={tenants() ?? []}>
							{(t: TenantRow): JSX.Element => <option value={t.id}>{t.name}</option>}
						</For>
					</select>
				</div>
				<div class="field">
					<label for="device-status">Status</label>
					<select
						id="device-status"
						value={status()}
						onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
							setStatus(e.currentTarget.value)
						}
					>
						<option value="active">active</option>
						<option value="planned">planned</option>
						<option value="staged">staged</option>
						<option value="decommissioned">decommissioned</option>
					</select>
				</div>
				<div class="field">
					<label for="device-asset-tag">Asset tag</label>
					<input
						id="device-asset-tag"
						placeholder="Asset tag (optional)"
						maxLength={100}
						value={assetTag()}
						onInput={(e: InputEventAndTarget) => setAssetTag(e.currentTarget.value)}
					/>
				</div>
				<div class="field">
					<label for="device-shelf">Shelf id</label>
					<input
						id="device-shelf"
						placeholder="Shelf id (or empty)"
						inputmode="numeric"
						value={shelfId()}
						onInput={(e: InputEventAndTarget) => setShelfId(e.currentTarget.value)}
					/>
				</div>
				<Show when={formError()}>
					<div class="app-inline-error" role="alert">
						{formError()}
					</div>
				</Show>
				<div class="form-actions">
					<button type="submit" disabled={saving()}>
						{saving() ? 'Creating…' : 'Create'}
					</button>
					<button type="button" onClick={() => navigate('/devices')} disabled={saving()}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	)
}
