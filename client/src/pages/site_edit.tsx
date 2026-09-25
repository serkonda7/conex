import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { fetch_site, fetch_site_groups, fetch_tenants, update_site } from '../api_tenancy'
import {
	EditActions,
	EditPageShell,
	FormError,
	Hint,
	NameField,
	row_options,
	SelectField,
	SlugField,
	TextAreaField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { type FormValues, submit_edit, useEditForm } from '../util/form'

/** /sites/:id/edit — site edit form. Saves back to the detail page. */
export function SiteEditPage(props: { id: number }): JSX.Element {
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [tenantId, setTenantId] = createSignal('')
	const [groupId, setGroupId] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [physicalAddress, setPhysicalAddress] = createSignal('')
	const [shippingAddress, setShippingAddress] = createSignal('')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [tenants] = createResource(async () => {
		const res = await fetch_tenants()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [groups] = createResource(async () => {
		const res = await fetch_site_groups()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [site] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_site(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setName(res.value.name)
			setSlug(res.value.slug)
			setTenantId(res.value.tenant_id ? String(res.value.tenant_id) : '')
			setGroupId(res.value.site_group_id ? String(res.value.site_group_id) : '')
			setDescription(res.value.description ?? '')
			setComments(res.value.comments ?? '')
			setPhysicalAddress(res.value.physical_address ?? '')
			setShippingAddress(res.value.shipping_address ?? '')
			setLoaded(true)
			return res.value
		},
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: name(),
			slug: slug(),
			save: (values: FormValues) =>
				update_site(props.id, {
					name: values.name,
					slug: values.slug,
					tenant_id: tenantId() ? Number(tenantId()) : null,
					site_group_id: groupId() ? Number(groupId()) : null,
					description: description().trim() === '' ? null : description().trim(),
					comments: comments().trim() === '' ? null : comments().trim(),
					physical_address:
						physicalAddress().trim() === '' ? null : physicalAddress().trim(),
					shipping_address:
						shippingAddress().trim() === '' ? null : shippingAddress().trim(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/sites/${props.id}`,
		})
	}

	return (
		<EditPageShell
			backTo={`/sites/${props.id}`}
			backLabel={site()?.name ?? tp('entity.site', 1)}
			title={t('site.editTitle')}
			loaded={loaded()}
			loadingText={t('site.loadingOne')}
			onSubmit={handleSave}
		>
			<NameField
				id="site-edit-name"
				placeholder={t('site.namePlaceholder')}
				value={name()}
				onInput={setName}
			/>
			<SlugField
				id="site-edit-slug"
				placeholder={t('site.slugPlaceholder')}
				value={slug()}
				onInput={setSlug}
				hint={<Hint>{t('form.slugHintEdit')}</Hint>}
			/>
			<SelectField
				id="site-edit-tenant"
				label={tp('entity.tenant', 1)}
				value={tenantId()}
				onChange={setTenantId}
				options={row_options(tenants() ?? [])}
				emptyLabel={t('common.noTenant')}
			/>
			<SelectField
				id="site-edit-group"
				label={t('common.group')}
				value={groupId()}
				onChange={setGroupId}
				options={row_options(groups() ?? [])}
				emptyLabel={t('common.noGroup')}
			/>
			<TextField
				id="site-edit-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="site-edit-comments"
				label={t('common.comments')}
				placeholder={t('common.commentsPlaceholder')}
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<TextAreaField
				id="site-edit-physical-address"
				label={t('site.physicalAddress')}
				placeholder={t('site.physicalAddressPlaceholder')}
				rows={3}
				maxLength={500}
				value={physicalAddress()}
				onInput={setPhysicalAddress}
			/>
			<TextAreaField
				id="site-edit-shipping-address"
				label={t('site.shippingAddress')}
				placeholder={t('site.shippingAddressPlaceholder')}
				rows={3}
				maxLength={500}
				value={shippingAddress()}
				onInput={setShippingAddress}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo={`/sites/${props.id}`} />
		</EditPageShell>
	)
}
