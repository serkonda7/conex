import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import {
	fetch_location,
	fetch_locations,
	fetch_site,
	fetch_tenants,
	type LocationType,
	update_location,
} from '../api_tenancy'
import {
	EditActions,
	EditPageShell,
	FormError,
	Hint,
	NameField,
	row_options,
	SelectField,
	SlugField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { locationTypeOptions } from '../i18n/labels'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /locations/:id/edit — location edit form. Saves back to the detail page. */
export function LocationEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [locationType, setLocationType] = createSignal<LocationType>('other')
	const [parentId, setParentId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
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

	const [location] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_location(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
			setLocationType(res.value.type)
			setParentId(res.value.parent_id ? String(res.value.parent_id) : '')
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setDescription(res.value.description ?? '')
			setSiteId(res.value.site_id)
			setLoaded(true)
			return res.value
		},
	)

	// Parent options stay within the same site; site itself is immutable.
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

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: name(),
			slug: slug(),
			save: (values: FormValues) =>
				update_location(props.id, {
					name: values.name,
					slug: values.slug,
					type: locationType(),
					parent_id: parentId() ? Number(parentId()) : null,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					description: description().trim() === '' ? null : description().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/locations/${props.id}`,
		})
	}

	return (
		<EditPageShell
			backTo={`/locations/${props.id}`}
			backLabel={location()?.name ?? tp('entity.location', 1)}
			title={t('location.editTitle')}
			loaded={loaded()}
			loadingText={t('location.loadingOne')}
			onSubmit={handleSave}
		>
			<div class="field">
				<label for="location-edit-site">{tp('entity.site', 1)}</label>
				<input
					id="location-edit-site"
					value={site()?.name ?? (siteId() ? String(siteId()) : '')}
					disabled
					aria-describedby="location-edit-site-hint"
				/>
				<p class="field-hint" id="location-edit-site-hint">
					{t('location.siteImmutable')}
				</p>
			</div>
			<NameField
				id="location-edit-name"
				placeholder={t('location.namePlaceholder')}
				value={name()}
				onInput={setName}
			/>
			<SlugField
				id="location-edit-slug"
				placeholder={t('location.slugPlaceholder')}
				value={slug()}
				onInput={setSlug}
				hint={<Hint>{t('form.slugHintEdit')}</Hint>}
			/>
			<SelectField
				id="location-edit-type"
				label={t('location.type')}
				required
				value={locationType()}
				onChange={(value: string): void => {
					setLocationType(value as LocationType)
				}}
				options={locationTypeOptions()}
			/>
			<SelectField
				id="location-edit-parent"
				label={t('site.parentLocation')}
				value={parentId()}
				onChange={setParentId}
				options={row_options((siblings() ?? []).filter((l) => l.id !== props.id))}
				emptyLabel={t('site.topLevel')}
			/>
			<SelectField
				id="location-edit-tenant"
				label={tp('entity.tenant', 1)}
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
			/>
			<TextField
				id="location-edit-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/locations/${props.id}`} />
		</EditPageShell>
	)
}
