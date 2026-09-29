import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import { create_integration } from '../api_integrations'
import { FormActions, FormError, FormPage } from '../components/form'
import { IntegrationFormFields, useIntegrationForm } from '../components/integration_form'
import { t } from '../i18n'
import { providerLabel } from '../i18n/labels'
import { submit_form } from '../util/form'

/**
 * /integrations/add — admin-only TANSS setup. Saving logs in to TANSS
 * first; the integration is only stored when the credentials work.
 */
export function IntegrationAddPage(): JSX.Element {
	const form = useIntegrationForm()
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			name: form.baseUrl(),
			nameError: t('integration.baseUrlRequired'),
			validate: (): string | null => {
				if (form.username().trim() === '') {
					return t('auth.usernameRequired')
				}
				if (form.password() === '') {
					return t('auth.passwordRequired')
				}
				if (form.erpToken() === '') {
					return t('integration.erpTokenRequired')
				}
				return null
			},
			save: () =>
				create_integration({
					provider: 'tanss',
					base_url: form.baseUrl().trim(),
					username: form.username().trim(),
					password: form.password(),
					erp_token: form.erpToken(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: '/integrations',
		})
	}

	return (
		<FormPage
			title={t('integration.addTitle', { name: providerLabel('tanss') })}
			onSubmit={handleCreate}
		>
			<IntegrationFormFields provider="tanss" form={form} editing={false} />
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo="/integrations" singleton />
		</FormPage>
	)
}
