import type { DeviceFace } from 'shared/src/types'
import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import { type DeviceRow, fetch_device, update_device } from '../../api/devices'
import { fetch_racks } from '../../api/racks'
import { fetch_device_types } from '../../api/templates'
import { fetch_locations, fetch_sites, fetch_tenants } from '../../api/tenancy'
import {
	AddOptionButton,
	DescriptionField,
	FormPage,
	Hint,
	NameField,
	ReadOnlyField,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { faceOptions } from '../../i18n/labels'
import { type FormValues, id_value, submit_form, text, useEntityForm } from '../../lib/form'
import { useNameOf } from '../../lib/lookup'
import { createRows, createRowsFor } from '../../lib/resource'
import { parseId } from '../../lib/router'
import { parsePosition, validPosition } from './add'

/** /devices/:id/edit — device edit form. Saves back to the detail page. */
export function DeviceEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [serial, setSerial] = createSignal('')
	const [roleId, setRoleId] = createSignal('')
	const [siteId, setSiteId] = createSignal('')
	const [locationId, setLocationId] = createSignal('')
	const [rackId, setRackId] = createSignal('')
	const [face, setFace] = createSignal('')
	const [positionU, setPositionU] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_device,
		fill: (row: DeviceRow) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setSerial(row.serial ?? '')
			setRoleId(id_value(row.device_role_id))
			setSiteId(id_value(row.site_id))
			setLocationId(id_value(row.location_id))
			setRackId(id_value(row.rack_id))
			setFace(row.face ?? '')
			setPositionU(id_value(row.position_u))
			setTenantId(id_value(row.tenant_id))
		},
	})
	const [sites] = createRows(fetch_sites, form.setError)
	const [racks] = createRows(fetch_racks, form.setError)
	const [roles] = createRows(fetch_device_roles, form.setError)
	const [tenants] = createRows(fetch_tenants, form.setError)
	const [types] = createRows(fetch_device_types)
	// Locations belong to a site, so the options follow the site picker.
	const [locations] = createRowsFor(
		() => parseId(siteId()),
		(key: number) => fetch_locations({ site: key }),
		form.setError,
	)
	const typeName = useNameOf(types, (type) => type.model)

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
					device_role_id: Number(roleId()),
					site_id: parseId(siteId()),
					location_id: parseId(locationId()),
					rack_id: parseId(rackId()),
					face: (face() || null) as DeviceFace | null,
					position_u: parsePosition(positionU()),
					tenant_id: parseId(tenantId()),
				}),
			navigateTo: `/devices/${props.id}`,
		})
	}

	return (
		<FormPage
			form={form}
			title={t('device.editTitle')}
			name={form.record()?.name}
			loadingText={t('device.loadingOne')}
			cancelTo={`/devices/${props.id}`}
			onSubmit={handleSave}
		>
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
				hint={t('device.typeImmutable')}
			/>
			<SelectField
				id="device-edit-role"
				label={tp('entity.deviceRole', 1)}
				required
				value={roleId()}
				onChange={setRoleId}
				options={row_options(roles() ?? [])}
				emptyLabel={t('device.rolePlaceholder')}
				action={
					<AddOptionButton label={tp('entity.deviceRole', 1)} href="/device-roles/add" />
				}
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
				hint={
					<Show when={siteId() === ''}>
						<Hint>{t('rack.pickSiteForLocation')}</Hint>
					</Show>
				}
			/>
			<SelectField
				id="device-edit-rack"
				label={tp('entity.rack', 1)}
				value={rackId()}
				onChange={setRackId}
				options={row_options(racks() ?? [])}
				emptyLabel="—"
			/>
			<SelectField
				id="device-edit-face"
				label={t('shelf.face')}
				value={face()}
				onChange={setFace}
				options={faceOptions()}
				emptyLabel={t('device.noFace')}
			/>
			<TextField
				id="device-edit-position"
				label={t('common.position')}
				placeholder={t('device.positionEditPlaceholder')}
				inputmode="numeric"
				value={positionU()}
				onInput={setPositionU}
				hint={<Hint>{t('device.positionEditHint')}</Hint>}
			/>
			<SelectField
				id="device-edit-tenant"
				label={tp('entity.tenant', 1)}
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
			/>
		</FormPage>
	)
}
