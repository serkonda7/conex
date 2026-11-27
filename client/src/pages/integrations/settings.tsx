/**
 * Settings tab of a provider's detail page (design decision 0006): the connection
 * form with its test, then the danger zone. Blank secrets keep the stored
 * ones; a changed URL or credentials log in again before saving. The
 * Enabled switch lives in the page header, not here.
 */
import { createSignal, type JSX, Show } from 'solid-js'
import {
	delete_integration,
	type IntegrationJson,
	update_integration,
} from '../../api/integrations'
import { InlineError } from '../../components/feedback'
import { t } from '../../i18n'
import { providerLabel } from '../../i18n/labels'
import { useAction } from '../../lib/resource'
import { forgetDeleted } from '../../lib/router'
import { canGlobal } from '../../lib/session'
import { DangerZone, SettingsSection } from './detail_parts'
import {
	fillIntegrationForm,
	IntegrationFormFields,
	updateBody,
	useIntegrationForm,
} from './form_fields'

export function ProviderSettings(props: { integration: IntegrationJson }): JSX.Element {
	const fields = useIntegrationForm()
	fillIntegrationForm(fields, props.integration)
	const [error, setError] = createSignal<string | null>(null)
	const [saved, setSaved] = createSignal(false)
	const save = useAction(setError)
	const remove = useAction(setError)
	const name = (): string => providerLabel(props.integration.provider)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setSaved(false)
		const ok = await save.run(() =>
			update_integration(
				props.integration.provider,
				updateBody(props.integration.provider, fields, props.integration.enabled),
			),
		)
		if (ok) {
			fields.setPassword('')
			fields.setErpToken('')
			setSaved(true)
		}
	}

	async function handleRemove(): Promise<void> {
		if (!window.confirm(t('integration.confirmDelete', { name: name() }))) {
			return
		}
		const res = await remove.run(() => delete_integration(props.integration.provider))
		if (res) {
			forgetDeleted(`/integrations/${props.integration.id}`, '/integrations')
		}
	}

	return (
		<div class="integration-settings">
			<SettingsSection title={t('integration.connection')}>
				<form class="form-stacked" onSubmit={(e: SubmitEvent) => void handleSave(e)}>
					<IntegrationFormFields
						provider={props.integration.provider}
						form={fields}
						editing
					/>
					<div class="form-actions">
						<button type="submit" disabled={save.pending()}>
							{save.pending() ? t('common.saving') : t('common.save')}
						</button>
						<Show when={saved() && !save.pending()}>
							<span class="text-success" role="status">
								{t('integration.saved')}
							</span>
						</Show>
					</div>
				</form>
			</SettingsSection>
			<InlineError message={error()} />
			<Show when={canGlobal('integrations.manage')}>
				<DangerZone
					name={name()}
					pending={remove.pending()}
					onRemove={() => void handleRemove()}
				/>
			</Show>
		</div>
	)
}
