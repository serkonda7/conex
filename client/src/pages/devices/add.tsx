import type { DeviceFace } from 'shared/src/types'
import { createEffect, createSignal, type JSX, Show } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import { create_device, type DeviceRow, fetch_device } from '../../api/devices'
import { fetch_racks } from '../../api/racks'
import { fetch_shelf } from '../../api/shelves'
import { fetch_locations, fetch_sites, fetch_tenants } from '../../api/tenancy'
import {
	DescriptionField,
	FormPage,
	FormSection,
	Hint,
	NameField,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { faceOptions } from '../../i18n/labels'
import {
	type FormValues,
	id_value,
	is_add_another_submit,
	submit_form,
	text,
	useFormState,
} from '../../lib/form'
import { deviceRoleIcon } from '../../lib/icons'
import { createRecord, createRows, createRowsFor } from '../../lib/resource'
import { parseId, queryParam } from '../../lib/router'
import { useSiteTenant } from '../../lib/tenant_context'
import { useDeviceTypeOptions } from '../device_types/options'

/** Rack position from the field: null when blank, NaN when malformed. */
export function parsePosition(value: string): number | null {
	return value.trim() === '' ? null : Number(value)
}

/** Whether a parsed position is empty or a whole unit number. */
export function validPosition(position: number | null): boolean {
	return position === null || (Number.isInteger(position) && position >= 1)
}

/** `?face=` of a rack-elevation deep link, if it names a face. */
export function queryFace(): string {
	const face = queryParam('face')
	return face === 'front' || face === 'rear' ? face : ''
}

/**
 * /devices/add — NetBox-style device instantiate form. `?clone=<id>`
 * pre-fills it from that device, except the name, serial, device ID and
 * U position, which must differ per device.
 */
export function DeviceAddPage(): JSX.Element {
	const form = useFormState()
	const [name, setName] = createSignal('')
	const [typeId, setTypeId] = createSignal('')
	const [roleId, setRoleId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [serial, setSerial] = createSignal('')
	const [deviceId, setDeviceId] = createSignal('')
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [locationId, setLocationId] = createSignal(queryParam('location'))
	// Rack-install deep link (`/devices/add?rack=<id>&position_u=<u>&face=front`)
	// from the rack elevation pre-fills the mount so the U picker flows
	// straight into instantiation.
	const [rackId, setRackId] = createSignal(queryParam('rack'))
	const [face, setFace] = createSignal(queryFace())
	const [positionU, setPositionU] = createSignal(queryParam('position_u'))
	// Shelf deep link (`/devices/add?rack=<id>&shelf=<id>`) places the device
	// on that shelf: the rack follows the shelf and there is no U position.
	const [shelfId, setShelfId] = createSignal(parseId(queryParam('shelf')))
	const [shelf] = createRecord(shelfId, fetch_shelf, form.setError)

	const {
		types,
		options: typeOptions,
		reload: reloadTypes,
	} = useDeviceTypeOptions({}, form.setError)
	const [roles, { refetch: refetchRoles }] = createRows(fetch_device_roles, form.setError)
	const [sites] = createRows(fetch_sites, form.setError)
	const [racks] = createRows(fetch_racks, form.setError)
	const [tenants] = createRows(fetch_tenants, form.setError)
	// Locations belong to a site, so the options follow the site picker.
	const [locations] = createRowsFor(
		() => parseId(siteId()),
		(key: number) => fetch_locations({ site: key }),
		form.setError,
	)
	// 0U types are not rack-mounted.
	const zeroHeight = (): boolean => {
		const id = parseId(typeId())
		return (types() ?? []).find((type) => type.id === id)?.u_height === 0
	}
	createEffect(() => {
		if (zeroHeight() && shelfId() === null) {
			handleRackChange('')
		}
	})

	const { siteTenantId, siteOptions, tenant } = useSiteTenant(sites, siteId, () =>
		handleSiteChange(''),
	)

	const [source] = createRecord(() => parseId(queryParam('clone')), fetch_device, form.setError)
	createEffect(() => {
		const row = source()
		if (row) {
			fillFrom(row)
		}
	})

	function fillFrom(row: DeviceRow): void {
		setTypeId(id_value(row.device_type_id))
		setRoleId(id_value(row.device_role_id))
		setDescription(row.description ?? '')
		tenant.pick(id_value(row.tenant_id))
		setSiteId(id_value(row.site_id))
		setLocationId(id_value(row.location_id))
		setRackId(id_value(row.rack_id))
		setShelfId(row.shelf_id)
		setFace(row.face ?? '')
	}

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setLocationId('')
	}

	function handleRackChange(value: string): void {
		setRackId(value)
		if (value === '') {
			setFace('')
			setPositionU('')
		}
	}

	function validate(): string | null {
		if (!typeId()) {
			return t('device.selectTypeFirst')
		}
		if (!roleId()) {
			return t('device.selectRole')
		}
		return validPosition(parsePosition(positionU())) ? null : t('device.positionInvalid')
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const onShelf = shelfId() !== null
		await submit_form({
			form,
			name: name(),
			validate,
			save: (values: FormValues) =>
				create_device({
					device_type_id: Number(typeId()),
					device_role_id: Number(roleId()),
					name: values.name,
					description: text(description()),
					serial: text(serial()),
					device_id: text(deviceId()),
					site_id: parseId(siteId()),
					location_id: parseId(locationId()),
					rack_id: parseId(rackId()),
					face: onShelf ? null : ((face() || null) as DeviceFace | null),
					position_u: onShelf ? null : parsePosition(positionU()),
					shelf_id: shelfId(),
					tenant_id: parseId(tenant.value()),
				}),
			// Elevation deep links return to the rack they came from.
			navigateTo:
				rackId() && queryParam('rack') === rackId() ? `/racks/${rackId()}` : '/devices',
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	const shelfName = (): string =>
		shelf()?.name || t('common.unitPosition', { u: shelf()?.position_u ?? '' })

	return (
		<FormPage form={form} cancelTo="/devices" onSubmit={handleCreate}>
			<FormSection title={tp('entity.device', 1)}>
				<NameField id="device-name" value={name()} onInput={setName} autofocus />
				<SelectField
					id="device-type"
					label={tp('entity.deviceType', 1)}
					required
					value={typeId()}
					onChange={setTypeId}
					options={typeOptions()}
					emptyLabel={t('common.selectPlaceholder')}
					add={{ label: tp('entity.deviceType', 1), href: '/device-types/add' }}
					reload={reloadTypes}
				/>
				<SelectField
					id="device-role"
					label={tp('entity.deviceRole', 1)}
					required
					value={roleId()}
					onChange={setRoleId}
					options={(roles() ?? []).map((role) => ({
						value: role.id,
						label: role.name,
						icon: deviceRoleIcon(role.icon),
					}))}
					emptyLabel={t('common.selectPlaceholder')}
					add={{ label: tp('entity.deviceRole', 1), href: '/device-roles/add' }}
					reload={refetchRoles}
				/>
				<DescriptionField
					id="device-description"
					value={description()}
					onInput={setDescription}
				/>
				<TextField
					id="device-serial"
					label={t('device.serial')}
					maxLength={100}
					value={serial()}
					onInput={setSerial}
				/>
				<TextField
					id="device-device-id"
					label={t('device.deviceId')}
					maxLength={100}
					value={deviceId()}
					onInput={setDeviceId}
				/>
			</FormSection>
			<FormSection title={tp('entity.location', 1)}>
				<SelectField
					id="device-site"
					label={tp('entity.site', 1)}
					value={siteId()}
					onChange={handleSiteChange}
					options={row_options(siteOptions())}
					emptyLabel={t('common.selectPlaceholder')}
				/>
				<SelectField
					id="device-location"
					label={tp('entity.location', 1)}
					value={locationId()}
					disabled={siteId() === ''}
					onChange={setLocationId}
					options={row_options(locations() ?? [])}
					emptyLabel={t('common.selectPlaceholder')}
				/>
				<SelectField
					id="device-rack"
					label={tp('entity.rack', 1)}
					value={rackId()}
					disabled={shelfId() !== null || zeroHeight()}
					onChange={handleRackChange}
					options={row_options(racks() ?? [])}
					emptyLabel={t('common.selectPlaceholder')}
				/>
				<SelectField
					id="device-face"
					label={t('shelf.face')}
					value={face()}
					disabled={rackId() === '' || shelfId() !== null}
					onChange={setFace}
					options={faceOptions()}
					emptyLabel={t('common.selectPlaceholder')}
				/>
				<TextField
					id="device-position"
					label={t('common.position')}
					inputmode="numeric"
					value={positionU()}
					disabled={rackId() === '' || shelfId() !== null}
					onInput={setPositionU}
					hint={
						<Hint>
							{shelfId() === null
								? ''
								: t('device.onShelfHint', { name: shelfName() })}
						</Hint>
					}
				/>
				<SelectField
					id="device-tenant"
					label={tp('entity.tenant', 1)}
					value={tenant.value()}
					onChange={tenant.pick}
					options={row_options(tenants() ?? [])}
					emptyLabel={t('common.selectPlaceholder')}
					hint={
						<Show when={!tenant.touched() && siteTenantId() !== null}>
							<Hint>{t('location.tenantFromSite')}</Hint>
						</Show>
					}
				/>
			</FormSection>
		</FormPage>
	)
}
