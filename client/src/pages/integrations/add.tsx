import { INTEGRATION_PROVIDERS, providerNeedsErpToken } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { create_integration, type IntegrationProvider } from '../../api/integrations'
import { FormPage } from '../../components/form'
import { t } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { submit_form, useFormState } from '../../lib/form'
import { queryParam } from '../../lib/router'
import { IntegrationFormFields, useIntegrationForm } from './form_fields'
import { providerUsesMailLogin } from './provider_capabilities'

/** Provider of `?provider=`, defaulting to TANSS when missing or unknown. */
function selectedProvider(): IntegrationProvider {
	const raw = queryParam('provider')
	return (INTEGRATION_PROVIDERS as readonly string[]).includes(raw)
		? (raw as IntegrationProvider)
		: 'tanss'
}

/**
 * /integrations/add?provider=… — setup of the chosen provider
 * (`integrations.manage`), TANSS when no provider is given. Saving logs in to
 * the external system first; the integration is only stored when the
 * credentials work. Providers without an ERP token (Octoja) neither ask for
 * nor send one.
 */
export function IntegrationAddPage(): JSX.Element {
	const form = useFormState()
	const fields = useIntegrationForm()
	const provider = selectedProvider()
	const needsErpToken = (): boolean => providerNeedsErpToken(provider)

	function validate(): string | null {
		if (fields.username().trim() === '') {
			return providerUsesMailLogin(provider)
				? t('integration.mailAddressRequired')
				: t('auth.usernameRequired')
		}
		if (fields.password() === '') {
			return t('auth.passwordRequired')
		}
		return needsErpToken() && fields.erpToken() === ''
			? t('integration.erpTokenRequired')
			: null
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
					provider,
					base_url: fields.baseUrl().trim(),
					username: fields.username().trim(),
					password: fields.password(),
					erp_token: needsErpToken() ? fields.erpToken() : undefined,
				}),
			navigateTo: '/integrations',
		})
	}

	return (
		<FormPage
			form={form}
			title={t('integration.addTitle', { name: providerLabel(provider) })}
			cancelTo="/integrations"
			singleton
			onSubmit={handleCreate}
		>
			<IntegrationFormFields provider={provider} form={fields} editing={false} />
		</FormPage>
	)
}
