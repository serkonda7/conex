import { createEffect, createMemo, createSignal, type JSX, Show } from 'solid-js'
import {
	create_location,
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationType,
	type SiteRow,
} from '../../api/tenancy'
import {
	DescriptionField,
	FormPage,
	Hint,
	NameField,
	row_options,
	SelectField,
	SlugField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { locationTypeOptions } from '../../i18n/labels'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	use_slug_fields,
	useFormState,
} from '../../lib/form'
import { createRows, createRowsFor } from '../../lib/resource'
import { parseId, queryParam } from '../../lib/router'
import { rowsOfTenant, useTenantDefault } from '../../lib/tenant_context'

/** /locations/add — NetBox-style location create form. */
export function LocationAddPage(): JSX.Element {
	const form = useFormState()
	const slugFields = use_slug_fields()
	const [siteId, setSiteId] = createSignal(queryParam('site'))
	const [locationType, setLocationType] = createSignal<LocationType>('other')
	const [parentId, setParentId] = createSignal('')
	const [description, setDescription] = createSignal('')

	const [sites] = createRows(fetch_sites, form.setError)
	const [tenants] = createRows(fetch_tenants, form.setError)
	// Parent options belong to a site, so they follow the site picker.
	const [parents] = createRowsFor(
		() => parseId(siteId()),
		(key: number) => fetch_locations({ site: key }),
		form.setError,
	)
	const selectedSite = (): SiteRow | undefined => {
		const id = parseId(siteId())
		return (sites() ?? []).find((s) => s.id === id)
	}

	// Tenant defaults to the selected site's tenant until picked explicitly.
	const tenant = useTenantDefault(
		() => selectedSite()?.tenant_id ?? null,
		() => sites() !== undefined,
	)

	// A selected tenant only offers its own sites; a site of another tenant
	// (e.g. from `?site=`) is dropped.
	const siteOptions = createMemo(() => rowsOfTenant(sites() ?? [], tenant.selected()))
	createEffect(() => {
		const site = selectedSite()
		if (site !== undefined && !siteOptions().includes(site)) {
			handleSiteChange('')
		}
	})

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setParentId('')
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: slugFields.name(),
			slug: slugFields.slug(),
			validate: () => (parseId(siteId()) === null ? t('location.selectSiteFirst') : null),
			save: (values: FormValues) =>
				create_location({
					name: values.name,
					slug: values.slug,
					type: locationType(),
					site_id: Number(siteId()),
					parent_id: parseId(parentId()),
					tenant_id: parseId(tenant.value()),
					description: text(description()),
				}),
			navigateTo: '/locations',
			onSuccess: is_add_another_submit(e) ? slugFields.resetName : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={t('location.addTitle')}
			cancelTo="/locations"
			onSubmit={handleCreate}
		>
			<NameField
				id="location-name"
				placeholder={t('location.namePlaceholder')}
				value={slugFields.name()}
				onInput={slugFields.handleNameInput}
				autofocus
			/>
			<SlugField
				id="location-slug"
				placeholder={t('location.slugPlaceholder')}
				value={slugFields.slug()}
				onInput={slugFields.handleSlugInput}
			/>
			<SelectField
				id="location-type"
				label={t('location.type')}
				required
				value={locationType()}
				onChange={(value: string): void => {
					setLocationType(value as LocationType)
				}}
				options={locationTypeOptions()}
			/>
			<SelectField
				id="location-site"
				label={tp('entity.site', 1)}
				required
				value={siteId()}
				onChange={handleSiteChange}
				options={row_options(siteOptions())}
				emptyLabel={t('location.sitePlaceholder')}
			/>
			<SelectField
				id="location-parent"
				label={t('site.parentLocation')}
				value={parentId()}
				disabled={siteId() === ''}
				onChange={setParentId}
				options={row_options(parents() ?? [])}
				emptyLabel={t('site.topLevel')}
			/>
			<SelectField
				id="location-tenant"
				label={tp('entity.tenant', 1)}
				value={tenant.value()}
				onChange={tenant.pick}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
				hint={
					<Show when={!tenant.touched() && selectedSite()?.tenant_id != null}>
						<Hint>{t('location.tenantFromSite')}</Hint>
					</Show>
				}
			/>
			<DescriptionField
				id="location-description"
				value={description()}
				onInput={setDescription}
			/>
		</FormPage>
	)
}
