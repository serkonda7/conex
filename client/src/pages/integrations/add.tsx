import { INTEGRATION_PROVIDERS } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { create_integration, type IntegrationProvider } from '../../api/integrations'
import { FormPage } from '../../components/form'
import { t } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { submit_form, useFormState } from '../../lib/form'
import { queryParam } from '../../lib/router'
import {
	createBody,
	IntegrationFormFields,
	useIntegrationForm,
	validateIntegrationForm,
} from './form_fields'

/** `?provider=` of the add page; TANSS when missing or unknown. */
function parseProvider(raw: string): IntegrationProvider {
	return (INTEGRATION_PROVIDERS as readonly string[]).includes(raw)
		? (raw as IntegrationProvider)
		: 'tanss'
}

/**
 * /integrations/add?provider= — provider setup (`integrations.manage`). Saving logs in
 * first; the integration is only stored when the credentials work.
 */
export function IntegrationAddPage(): JSX.Element {
	const form = useFormState()
	const fields = useIntegrationForm()
	const provider = parseProvider(queryParam('provider'))

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: '',
			optionalName: true,
			validate: () => validateIntegrationForm(provider, fields),
			save: () => create_integration(createBody(provider, fields)),
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
