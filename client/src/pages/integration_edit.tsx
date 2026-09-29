import { Result } from 'better-result'
import { createResource, createSignal, type JSX } from 'solid-js'
import { fetch_integrations, update_integration } from '../api_integrations'
import { EditActions, EditPageShell, FormError, SelectField } from '../components/form'
import { IntegrationFormFields, useIntegrationForm } from '../components/integration_form'
import { t } from '../i18n'
import { providerLabel } from '../i18n/labels'
import { navigate } from '../router'
import { useEditForm } from '../util/form'

/**
 * /integrations/:id/edit — admin-only. Blank secrets keep the stored ones;
 * changing URL or credentials logs in again before saving.
 */
export function IntegrationEditPage(props: { id: number }): JSX.Element {
	const form = useIntegrationForm()
	const [enabled, setEnabled] = createSignal('1')
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [integration] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_integrations()
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			const row = res.value.find((i) => i.id === id)
			if (!row) {
				setFormError(t('integration.notFound'))
				return null
			}
			form.setBaseUrl(row.base_url)
			form.setUsername(row.username)
			setEnabled(row.enabled ? '1' : '0')
			setLoaded(true)
			return row
		},
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setFormError(null)
		const row = integration()
		if (!row) {
			return
		}
		setSaving(true)
		const res = await update_integration(row.provider, {
			base_url: form.baseUrl().trim(),
			username: form.username().trim(),
			...(form.password() !== '' ? { password: form.password() } : {}),
			...(form.erpToken() !== '' ? { erp_token: form.erpToken() } : {}),
			enabled: enabled() === '1',
		})
		setSaving(false)
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return
		}
		navigate('/integrations')
	}

	return (
		<EditPageShell
			name={integration() ? providerLabel(integration()?.provider ?? 'tanss') : undefined}
			title={t('integration.editTitle', {
				name: providerLabel(integration()?.provider ?? 'tanss'),
			})}
			loaded={loaded()}
			loadingText={t('integration.loadingOne')}
			onSubmit={handleSave}
		>
			<IntegrationFormFields
				provider={integration()?.provider ?? 'tanss'}
				form={form}
				editing
			/>
			<SelectField
				id="integration-enabled"
				label={t('integration.enabled')}
				value={enabled()}
				onChange={setEnabled}
				options={[
					{ value: '1', label: t('common.yes') },
					{ value: '0', label: t('common.no') },
				]}
			/>
			<FormError message={formError} />
			<EditActions saving={saving()} cancelTo="/integrations" />
		</EditPageShell>
	)
}
