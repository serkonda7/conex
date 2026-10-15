import { createSignal, type JSX, Show } from 'solid-js'
import {
	create_location,
	fetch_locations,
	fetch_sites,
	fetch_tenants,
	type LocationType,
} from '../../api/tenancy'
import {
	DescriptionField,
	FormPage,
	Hint,
	NameField,
	row_options,
	SelectField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { locationTypeOptions } from '../../i18n/labels'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useFormState,
} from '../../lib/form'
import { createRows, createRowsFor } from '../../lib/resource'
import { parseId, queryParam } from '../../lib/router'
import { useSiteTenant } from '../../lib/tenant_context'

/** /locations/add — NetBox-style location create form. */
export function LocationAddPage(): JSX.Element {
	const form = useFormState()
	const [name, setName] = createSignal('')
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
	const { siteTenantId, siteOptions, tenant } = useSiteTenant(sites, siteId, () =>
		handleSiteChange(''),
	)

	function handleSiteChange(value: string): void {
		setSiteId(value)
		setParentId('')
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: name(),
			validate: () => (parseId(siteId()) === null ? t('location.selectSiteFirst') : null),
			save: (values: FormValues) =>
				create_location({
					name: values.name,
					type: locationType(),
					site_id: Number(siteId()),
					parent_id: parseId(parentId()),
					tenant_id: parseId(tenant.value()),
					description: text(description()),
				}),
			navigateTo: '/locations',
			onSuccess: is_add_another_submit(e)
				? (): void => {
						setName('')
					}
				: undefined,
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
				value={name()}
				onInput={setName}
				autofocus
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
					<Show when={!tenant.touched() && siteTenantId() !== null}>
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
