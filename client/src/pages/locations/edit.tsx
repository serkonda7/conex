import { createSignal, type JSX } from 'solid-js'
import {
	fetch_location,
	fetch_locations,
	fetch_site,
	fetch_tenants,
	type LocationRow,
	type LocationType,
	update_location,
} from '../../api/tenancy'
import {
	DescriptionField,
	FormPage,
	NameField,
	ReadOnlyField,
	row_options,
	SelectField,
	SlugField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { locationTypeOptions } from '../../i18n/labels'
import {
	type FormValues,
	id_value,
	submit_form,
	text,
	use_slug_fields,
	useEntityForm,
} from '../../lib/form'
import { createRecord, createRows, createRowsFor } from '../../lib/resource'
import { parseId } from '../../lib/router'

/** /locations/:id/edit — location edit form. Saves back to the detail page. */
export function LocationEditPage(props: { id: number }): JSX.Element {
	const slugFields = use_slug_fields()
	const [locationType, setLocationType] = createSignal<LocationType>('other')
	const [parentId, setParentId] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_location,
		fill: (row: LocationRow) => {
			slugFields.fill(row.name, row.slug)
			setLocationType(row.type)
			setParentId(id_value(row.parent_id))
			setTenantId(id_value(row.tenant_id))
			setDescription(row.description ?? '')
		},
	})
	// The site is immutable; parent options stay within it.
	const siteId = (): number | undefined => form.record()?.site_id
	const [tenants] = createRows(fetch_tenants, form.setError)
	const [siblings] = createRowsFor(
		siteId,
		(key: number) => fetch_locations({ site: key }),
		form.setError,
	)
	const [site] = createRecord(siteId, fetch_site)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: slugFields.name(),
			slug: slugFields.slug(),
			save: (values: FormValues) =>
				update_location(props.id, {
					name: values.name,
					slug: values.slug,
					type: locationType(),
					parent_id: parseId(parentId()),
					tenant_id: parseId(tenantId()),
					description: text(description()) ?? null,
				}),
			navigateTo: `/locations/${props.id}`,
		})
	}

	return (
		<FormPage
			form={form}
			title={t('location.editTitle')}
			name={form.record()?.name}
			loadingText={t('location.loadingOne')}
			cancelTo={`/locations/${props.id}`}
			onSubmit={handleSave}
		>
			<ReadOnlyField
				id="location-edit-site"
				label={tp('entity.site', 1)}
				value={site()?.name ?? id_value(siteId())}
				hint={t('location.siteImmutable')}
			/>
			<NameField
				id="location-edit-name"
				placeholder={t('location.namePlaceholder')}
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
			/>
			<SlugField
				id="location-edit-slug"
				placeholder={t('location.slugPlaceholder')}
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
				editing
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
			<DescriptionField
				id="location-edit-description"
				value={description()}
				onInput={setDescription}
			/>
		</FormPage>
	)
}
