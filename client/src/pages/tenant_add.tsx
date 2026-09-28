import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { create_tenant, fetch_tenant_groups } from '../api_tenancy'
import {
	FormActions,
	FormError,
	FormPage,
	Hint,
	NameField,
	row_options,
	SelectField,
	TextAreaField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { queryParam } from '../router'
import { contextGroupId, refreshTenantContext, setTenantContext } from '../tenant_context'
import { type FormValues, is_add_another_submit, load_rows, submit_form } from '../util/form'

/** /tenants/add — NetBox-style tenant create form. */
export function TenantAddPage(): JSX.Element {
	const [name, setName] = createSignal(queryParam('name'))
	// Opened from the top-bar selector: prefill its search and select the
	// new tenant as context once created.
	const selectAfterCreate = queryParam('select') === '1'
	// A selected tenant-group context preselects that group.
	const [groupId, setGroupId] = createSignal(String(contextGroupId() ?? ''))
	const [description, setDescription] = createSignal('')
	const [comments, setComments] = createSignal('')
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	const [groups] = createResource(() => load_rows(() => fetch_tenant_groups(), setFormError))

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: name(),
			save: async (values: FormValues) => {
				const res = await create_tenant({
					name: values.name,
					tenant_group_id: groupId() === '' ? null : Number(groupId()),
					description: description().trim() || undefined,
					comments: comments().trim() || undefined,
				})
				if (selectAfterCreate && Result.isOk(res)) {
					setTenantContext({ kind: 'tenant', id: res.value.id })
					void refreshTenantContext()
				}
				return res
			},
			setError: setFormError,
			setSaving,
			navigateTo: '/tenants',
			onSuccess: is_add_another_submit(e) ? () => setName('') : undefined,
		})
	}

	return (
		<FormPage title={t('tenant.addTitle')} onSubmit={handleCreate}>
			<NameField
				id="tenant-name"
				placeholder={t('tenant.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus
			/>
			<SelectField
				id="tenant-group"
				label={tp('entity.tenantGroup', 1)}
				value={groupId()}
				onChange={setGroupId}
				options={row_options(groups() ?? [])}
				emptyLabel={t('common.noGroup')}
				hint={<Hint>{t('tenantGroup.hint')}</Hint>}
			/>
			<TextField
				id="tenant-description"
				label={t('common.description')}
				placeholder={t('common.descriptionPlaceholder')}
				maxLength={500}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id="tenant-comments"
				label={t('common.comments')}
				placeholder={t('common.commentsPlaceholder')}
				maxLength={2000}
				value={comments()}
				onInput={setComments}
			/>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/tenants" />
		</FormPage>
	)
}
