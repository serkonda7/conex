import { Result } from 'better-result'
import { createResource, createSignal, type JSX, Show } from 'solid-js'
import { fetch_rack, update_rack } from '../api_racks'
import { type DeviceTypeRow, fetch_device_types } from '../api_templates'
import { fetch_location, fetch_locations, fetch_site, fetch_tenants } from '../api_tenancy'
import {
	EditActions,
	EditPageShell,
	FormError,
	NameField,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /racks/:id/edit — rack edit form. Saves back to the detail page. */
export function RackEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [locationId, setLocationId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [rackTypeId, setRackTypeId] = createSignal('')
	const [siteId, setSiteId] = createSignal<number | null>(null)
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [rackTypes] = createResource(async () => {
		const res = await fetch_device_types({ kind: 'rack' })
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [rack] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_rack(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setLocationId(res.value.location_id ? String(res.value.location_id) : '')
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setDescription(res.value.description ?? '')
			setRackTypeId(String(res.value.rack_type_id))
			setSiteId(res.value.site_id)
			setLoaded(true)
			return res.value
		},
	)

	// Location options stay within the same site; site itself is immutable.
	const [siblings] = createResource(siteId, async (siteKey: number | null) => {
		if (!siteKey) {
			return []
		}
		const res = await fetch_locations({ site: siteKey })
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [site] = createResource(siteId, async (siteKey: number | null) => {
		if (!siteKey) {
			return null
		}
		const res = await fetch_site(siteKey)
		if (Result.isError(res)) {
			return null
		}
		return res.value
	})

	const [currentLocation] = createResource(locationId, async (raw: string) => {
		if (!raw) {
			return null
		}
		const res = await fetch_location(Number(raw))
		if (Result.isError(res)) {
			return null
		}
		return res.value
	})

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: name(),
			save: (values: FormValues) =>
				update_rack(props.id, {
					name: values.name,
					rack_type_id: Number(rackTypeId()),
					location_id: locationId() ? Number(locationId()) : null,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					description: description().trim() === '' ? null : description().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/racks/${props.id}`,
		})
	}

	return (
		<EditPageShell
			backTo={`/racks/${props.id}`}
			backLabel={rack()?.name ?? tp('entity.rack', 1)}
			title={t('rack.editTitle')}
			loaded={loaded()}
			loadingText={t('rack.loadingOne')}
			onSubmit={handleSave}
		>
			<div class="field">
				<label for="rack-edit-site">{tp('entity.site', 1)}</label>
				<input
					id="rack-edit-site"
					value={site()?.name ?? (siteId() ? String(siteId()) : '')}
					disabled
					aria-describedby="rack-edit-site-hint"
				/>
				<p class="field-hint" id="rack-edit-site-hint">
					{t('location.siteImmutable')}
				</p>
			</div>
			<SelectField
				id="rack-edit-location"
				label={tp('entity.location', 1)}
				value={locationId()}
				onChange={setLocationId}
				options={row_options(siblings() ?? [])}
				emptyLabel={t('rack.noLocation')}
			>
				<Show
					when={
						locationId() !== '' &&
						(siblings() ?? []).every((l) => String(l.id) !== locationId()) &&
						currentLocation()
					}
				>
					<option value={currentLocation()?.id ?? locationId()}>
						{currentLocation()?.name ?? locationId()}
					</option>
				</Show>
			</SelectField>
			<NameField id="rack-edit-name" placeholder="A1" value={name()} onInput={setName} />
			<TextField
				id="rack-edit-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<SelectField
				id="rack-edit-type"
				label={tp('entity.rackType', 1)}
				value={rackTypeId()}
				onChange={setRackTypeId}
				options={(rackTypes() ?? []).map((type: DeviceTypeRow) => ({
					value: type.id,
					label: type.model,
				}))}
				required
			/>
			<SelectField
				id="rack-edit-tenant"
				label={tp('entity.tenant', 1)}
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/racks/${props.id}`} />
		</EditPageShell>
	)
}
