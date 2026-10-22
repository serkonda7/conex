import type { DeviceFace } from 'shared/src/types'
import { createSignal, type JSX } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import { type DeviceRow, fetch_device, update_device } from '../../api/devices'
import { fetch_racks } from '../../api/racks'
import { fetch_device_types } from '../../api/templates'
import { fetch_locations, fetch_sites } from '../../api/tenancy'
import {
	DescriptionField,
	FormPage,
	FormSection,
	NameField,
	ReadOnlyField,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { type FormValues, id_value, submit_form, text, useEntityForm } from '../../lib/form'
import { useNameOf } from '../../lib/lookup'
import { createRows, createRowsFor } from '../../lib/resource'
import { parseId, useFormReturnRoute } from '../../lib/router'
import { deviceRoleOptions } from '../device-roles/options'
import { parsePosition, validPosition } from './add'
import { EmployeeAssignmentField } from './employee_assignment'
import { RackMountField } from './rack_mount'

/**
 * /devices/:id/edit — device edit form. Saves back to the device list when
 * opened from it, else to the detail page.
 *
 * Shares its layout (sections, field order, rack mount row) with the add
 * form in `add.tsx`, so a device looks the same while created and edited;
 * keep the two in sync.
 */
export function DeviceEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [serial, setSerial] = createSignal('')
	const [deviceId, setDeviceId] = createSignal('')
	const [roleId, setRoleId] = createSignal('')
	const [siteId, setSiteId] = createSignal('')
	const [locationId, setLocationId] = createSignal('')
	const [rackId, setRackId] = createSignal('')
	const [face, setFace] = createSignal('')
	const [positionU, setPositionU] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [employeeId, setEmployeeId] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_device,
		fill: (row: DeviceRow) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setSerial(row.serial ?? '')
			setDeviceId(row.device_id ?? '')
			setRoleId(id_value(row.device_role_id))
			setSiteId(id_value(row.site_id))
			setLocationId(id_value(row.location_id))
			setRackId(id_value(row.rack_id))
			setFace(row.face ?? '')
			setPositionU(id_value(row.position_u))
			setTenantId(id_value(row.tenant_id))
			setEmployeeId(id_value(row.employee_id))
		},
	})
	// Sites, locations and racks are limited to the device's tenant; a device
	// without one may use any. Nothing loads before the device does.
	const tenantFilter = (): { tenant?: number } | null => {
		if (!form.record()) {
			return null
		}
		const tenant = parseId(tenantId())
		return tenant === null ? {} : { tenant }
	}
	const [sites] = createRowsFor(tenantFilter, fetch_sites, form.setError)
	const [racks] = createRowsFor(tenantFilter, fetch_racks, form.setError)
	const [roles] = createRows(fetch_device_roles, form.setError)
	const [types] = createRows(fetch_device_types)
	// Locations belong to a site, so the options follow the site picker.
	const [locations] = createRowsFor(
		() => {
			const site = parseId(siteId())
			return site === null ? null : { site, ...tenantFilter() }
		},
		({ site, tenant }: { site: number; tenant?: number }) =>
			fetch_locations({ site: [site], tenant }),
		form.setError,
	)
	const typeName = useNameOf(types, (type) => type.model)
	const backTo = useFormReturnRoute('/devices', props.id)

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setLocationId('')
	}

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: name(),
			validate: () => {
				if (!roleId()) {
					return t('device.selectRole')
				}
				return validPosition(parsePosition(positionU()))
					? null
					: t('device.positionInvalid')
			},
			save: (values: FormValues) =>
				update_device(props.id, {
					name: values.name,
					description: text(description()) ?? null,
					serial: text(serial()) ?? null,
					device_id: text(deviceId()) ?? null,
					device_role_id: Number(roleId()),
					site_id: parseId(siteId()),
					location_id: parseId(locationId()),
					rack_id: parseId(rackId()),
					face: (face() || null) as DeviceFace | null,
					position_u: parsePosition(positionU()),
					employee_id: parseId(employeeId()),
				}),
			navigateTo: backTo(),
		})
	}

	return (
		<FormPage
			form={form}
			title={t('device.editTitle')}
			name={form.record()?.name}
			loadingText={t('device.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSave}
		>
			<FormSection title={tp('entity.device', 1)}>
				<NameField
					id="device-edit-name"
					placeholder={t('device.namePlaceholder')}
					value={name()}
					onInput={setName}
				/>
				<ReadOnlyField
					id="device-edit-type"
					label={tp('entity.deviceType', 1)}
					value={form.record() ? typeName(form.record()?.device_type_id) : ''}
				/>
				<SelectField
					id="device-edit-role"
					label={tp('entity.deviceRole', 1)}
					required
					value={roleId()}
					onChange={setRoleId}
					options={deviceRoleOptions(roles() ?? [])}
					emptyLabel={t('device.rolePlaceholder')}
					add={{ label: tp('entity.deviceRole', 1), href: '/device-roles/add' }}
				/>
				<DescriptionField
					id="device-edit-description"
					value={description()}
					onInput={setDescription}
				/>
				<TextField
					id="device-edit-serial"
					label={t('device.serial')}
					placeholder={t('device.serialPlaceholder')}
					maxLength={100}
					value={serial()}
					onInput={setSerial}
				/>
				<TextField
					id="device-edit-device-id"
					label={t('device.deviceId')}
					placeholder={t('device.deviceIdPlaceholder')}
					maxLength={100}
					value={deviceId()}
					onInput={setDeviceId}
				/>
			</FormSection>
			<FormSection title={t('device.assignmentSection')}>
				<EmployeeAssignmentField
					id="device-edit-employee"
					tenantId={parseId(tenantId())}
					value={employeeId()}
					onChange={setEmployeeId}
					onError={form.setError}
				/>
			</FormSection>
			<FormSection title={t('device.locationSection')}>
				<SelectField
					id="device-edit-site"
					label={tp('entity.site', 1)}
					value={siteId()}
					onChange={handleSiteChange}
					options={row_options(sites() ?? [])}
					emptyLabel={t('device.noSite')}
				/>
				<SelectField
					id="device-edit-location"
					label={tp('entity.location', 1)}
					value={locationId()}
					onChange={setLocationId}
					options={row_options(locations() ?? [])}
					emptyLabel={t('rack.noLocation')}
					disabled={siteId() === ''}
				/>
				<RackMountField
					idPrefix="device-edit"
					rackId={rackId()}
					face={face()}
					positionU={positionU()}
					onRackChange={setRackId}
					onFaceChange={setFace}
					onPositionInput={setPositionU}
					racks={row_options(racks() ?? [])}
					rackEmptyLabel="—"
					faceEmptyLabel={t('device.noFace')}
				/>
			</FormSection>
		</FormPage>
	)
}
