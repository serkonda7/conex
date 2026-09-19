import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationRow,
	type SiteRow,
	type TenantRow,
} from '../api_p1'
import { fetch_racks, type RackRow } from '../api_p2'
import { fetch_device_types } from '../api_p3'
import { fetch_device, update_device } from '../api_p4'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

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
	const [status, setStatus] = createSignal('active')
	const [assetTag, setAssetTag] = createSignal('')
	const [shelfId, setShelfId] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [loaded, setLoaded] = createSignal(false)

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
			setStatus(res.value.status)
			setAssetTag(res.value.asset_tag ?? '')
			setShelfId(res.value.shelf_id !== null ? String(res.value.shelf_id) : '')
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
		setFormError(null)
		const trimmedName = name().trim()
		if (!trimmedName) {
			setFormError('Name is required.')
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
		const trimmedSerial = serial().trim()
		const trimmedDescription = description().trim()
		const trimmedAsset = assetTag().trim()
		const res = await update_device(props.id, {
			name: trimmedName,
			description: trimmedDescription === '' ? null : trimmedDescription,
			serial: trimmedSerial === '' ? null : trimmedSerial,
			site_id: siteId() ? Number(siteId()) : null,
			location_id: locationId() ? Number(locationId()) : null,
			rack_id: rackId() ? Number(rackId()) : null,
			face: (face() || null) as 'front' | 'rear' | null,
			position_u: position,
			tenant_id: tenantId() ? Number(tenantId()) : null,
			status: status() as 'active' | 'planned' | 'staged' | 'decommissioned',
			asset_tag: trimmedAsset === '' ? null : trimmedAsset,
			shelf_id: shelf,
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate(`/devices/${props.id}`)
	}

	return (
		<div class="form-page">
			<p>
				<a
					href={`/devices/${props.id}`}
					onClick={(e: MouseEvent): void => go(e, `/devices/${props.id}`)}
				>
					← {device()?.name ?? 'Device'}
				</a>
			</p>
			<h2>Edit device</h2>
			<Show when={loaded()} fallback={<p class="skeleton">Loading device…</p>}>
				<form class="form-stacked" onSubmit={handleSave}>
					<div class="field">
						<label for="device-edit-name">
							Name{' '}
							<span class="required" aria-hidden="true">
								*
							</span>
						</label>
						<input
							id="device-edit-name"
							placeholder="sw-access-01"
							required
							maxLength={100}
							value={name()}
							onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="device-edit-type">Device type</label>
						<input id="device-edit-type" value={typeName()} disabled />
						<p class="field-hint">
							The device type is immutable after create: swapping the template would
							invalidate the interfaces and the U footprint.
						</p>
					</div>
					<div class="field">
						<label for="device-edit-description">Description</label>
						<input
							id="device-edit-description"
							placeholder="Short summary (optional)"
							maxLength={500}
							value={description()}
							onInput={(e: InputEventAndTarget) =>
								setDescription(e.currentTarget.value)
							}
						/>
					</div>
					<div class="field">
						<label for="device-edit-serial">Serial</label>
						<input
							id="device-edit-serial"
							placeholder="Serial (optional)"
							maxLength={100}
							value={serial()}
							onInput={(e: InputEventAndTarget) => setSerial(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="device-edit-site">Site</label>
						<select
							id="device-edit-site"
							value={siteId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								handleSiteChange(e.currentTarget.value)
							}
						>
							<option value="">No site</option>
							<For each={sites() ?? []}>
								{(s: SiteRow): JSX.Element => (
									<option value={s.id}>{s.name}</option>
								)}
							</For>
						</select>
					</div>
					<div class="field">
						<label for="device-edit-location">Location</label>
						<select
							id="device-edit-location"
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
						<label for="device-edit-rack">Rack</label>
						<select
							id="device-edit-rack"
							value={rackId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setRackId(e.currentTarget.value)
							}
						>
							<option value="">Unracked</option>
							<For each={racks() ?? []}>
								{(r: RackRow): JSX.Element => (
									<option value={r.id}>{r.name}</option>
								)}
							</For>
						</select>
					</div>
					<div class="field">
						<label for="device-edit-face">Face</label>
						<select
							id="device-edit-face"
							value={face()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setFace(e.currentTarget.value)
							}
						>
							<option value="">No face</option>
							<option value="front">front</option>
							<option value="rear">rear</option>
						</select>
					</div>
					<div class="field">
						<label for="device-edit-position">U position</label>
						<input
							id="device-edit-position"
							placeholder="U position (empty clears)"
							inputmode="numeric"
							value={positionU()}
							onInput={(e: InputEventAndTarget) =>
								setPositionU(e.currentTarget.value)
							}
						/>
						<p class="field-hint">
							Either a rack position or a shelf, never both. Empty both plus no rack
							to unrack the device.
						</p>
					</div>
					<div class="field">
						<label for="device-edit-tenant">Tenant</label>
						<select
							id="device-edit-tenant"
							value={tenantId()}
							onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
								setTenantId(e.currentTarget.value)
							}
						>
							<option value="">No tenant</option>
							<For each={tenants() ?? []}>
								{(t: TenantRow): JSX.Element => (
									<option value={t.id}>{t.name}</option>
								)}
							</For>
						</select>
					</div>
					<div class="field">
						<label for="device-edit-status">Status</label>
						<select
							id="device-edit-status"
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
						<label for="device-edit-asset-tag">Asset tag</label>
						<input
							id="device-edit-asset-tag"
							placeholder="Asset tag (optional)"
							maxLength={100}
							value={assetTag()}
							onInput={(e: InputEventAndTarget) => setAssetTag(e.currentTarget.value)}
						/>
					</div>
					<div class="field">
						<label for="device-edit-shelf">Shelf id</label>
						<input
							id="device-edit-shelf"
							placeholder="Shelf id (empty clears)"
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
							{saving() ? 'Saving…' : 'Save'}
						</button>
						<button
							type="button"
							onClick={() => navigate(`/devices/${props.id}`)}
							disabled={saving()}
						>
							Cancel
						</button>
					</div>
				</form>
			</Show>
		</div>
	)
}
