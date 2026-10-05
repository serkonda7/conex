import { createSignal, type JSX } from 'solid-js'
import { fetch_integration, type IntegrationJson, update_integration } from '../../api/integrations'
import { FormPage, SelectField } from '../../components/form'
import { t } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { submit_form, useEntityForm } from '../../lib/form'
import { IntegrationFormFields, secrets, useIntegrationForm } from './form_fields'

/**
 * /integrations/:id/edit — `integrations.manage` only. Blank secrets keep the stored ones;
 * changing URL or credentials logs in again before saving.
 */
export function IntegrationEditPage(props: { id: number }): JSX.Element {
	const fields = useIntegrationForm()
	const [enabled, setEnabled] = createSignal('1')
	const form = useEntityForm({
		id: props.id,
		load: fetch_integration,
		fill: (row: IntegrationJson) => {
			fields.setBaseUrl(row.base_url)
			fields.setUsername(row.username)
			setEnabled(row.enabled ? '1' : '0')
		},
	})
	const provider = (): IntegrationJson['provider'] => form.record()?.provider ?? 'tanss'

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_form({
			form,
			name: '',
			optionalName: true,
			save: () =>
				update_integration(provider(), {
					base_url: fields.baseUrl().trim(),
					username: fields.username().trim(),
					...secrets(fields),
					enabled: enabled() === '1',
				}),
			navigateTo: '/integrations',
		})
	}

	return (
		<FormPage
			form={form}
			title={t('integration.editTitle', { name: providerLabel(provider()) })}
			name={form.record() ? providerLabel(provider()) : undefined}
			loadingText={t('integration.loadingOne')}
			cancelTo="/integrations"
			onSubmit={handleSave}
		>
			<IntegrationFormFields provider={provider()} form={fields} editing />
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
		</FormPage>
	)
}
