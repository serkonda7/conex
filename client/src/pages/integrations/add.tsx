import type { JSX } from 'solid-js'
import { create_integration } from '../../api/integrations'
import { FormPage } from '../../components/form'
import { t } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { submit_form, useFormState } from '../../lib/form'
import { IntegrationFormFields, useIntegrationForm } from './form_fields'

/**
 * /integrations/add — admin-only TANSS setup. Saving logs in to TANSS
 * first; the integration is only stored when the credentials work.
 */
export function IntegrationAddPage(): JSX.Element {
	const form = useFormState()
	const fields = useIntegrationForm()

	function validate(): string | null {
		if (fields.username().trim() === '') {
			return t('auth.usernameRequired')
		}
		if (fields.password() === '') {
			return t('auth.passwordRequired')
		}
		return fields.erpToken() === '' ? t('integration.erpTokenRequired') : null
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: fields.baseUrl(),
			nameError: t('integration.baseUrlRequired'),
			validate,
			save: () =>
				create_integration({
					provider: 'tanss',
					base_url: fields.baseUrl().trim(),
					username: fields.username().trim(),
					password: fields.password(),
					erp_token: fields.erpToken(),
				}),
			navigateTo: '/integrations',
		})
	}

	return (
		<FormPage
			form={form}
			title={t('integration.addTitle', { name: providerLabel('tanss') })}
			cancelTo="/integrations"
			singleton
			onSubmit={handleCreate}
		>
			<IntegrationFormFields provider="tanss" form={fields} editing={false} />
		</FormPage>
	)
}
