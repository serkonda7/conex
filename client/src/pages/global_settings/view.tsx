/**
 * /global-settings — installation-wide settings for global `settings.manage`
 * holders: the default model of each AI provider (an empty choice keeps the
 * model of the server config, `[ai.claude]` / `[ai.opencode]`) and the
 * cutoff day of the billing periods.
 */
import { Result } from 'better-result'
import type { AiProvider } from 'shared/src/types'
import { createResource, createSignal, type JSX, Show } from 'solid-js'
import {
	type AiModelJson,
	fetch_ai_models,
	fetch_global_settings,
	type GlobalSettingsJson,
	save_global_settings,
} from '../../api/global_settings'
import { InlineError, Loading } from '../../components/feedback'
import { type FormOption, Hint, SelectField, TextField } from '../../components/form'
import { t } from '../../i18n'
import { useAction } from '../../lib/resource'
import { SettingsSection } from '../integrations/detail_parts'

/** Picker options: the provider's models, plus a stored model it no longer lists. */
function modelOptions(models: readonly AiModelJson[], current: string): FormOption[] {
	const options: FormOption[] = models.map((m) => ({
		value: m.id,
		label: m.name,
		...(m.name !== m.id && { detail: m.id }),
	}))
	if (current !== '' && !models.some((m) => m.id === current)) {
		options.unshift({ value: current, label: current })
	}
	return options
}

/**
 * Default model of one provider: a picker over the models the provider
 * reports, or a text input when the list cannot be loaded (provider not
 * reachable or not configured).
 */
function ModelField(props: {
	provider: AiProvider
	label: string
	value: string
	onChange: (value: string) => void
	/** Model of the server config; null = the provider picks its own. */
	configModel: string | null
	active: boolean
	placeholder: string
}): JSX.Element {
	const [models] = createResource(() => fetch_ai_models(props.provider))
	const id = (): string => `global-settings-${props.provider}-model`
	const fallback = (): string =>
		t('globalSettings.useConfigModel', {
			model: props.configModel ?? t('globalSettings.providerDefault'),
		})
	const hint = (extra?: string): JSX.Element => (
		<Hint>
			{[props.active ? t('globalSettings.activeProvider') : null, extra]
				.filter(Boolean)
				.join(' ')}
		</Hint>
	)
	const loaded = (): AiModelJson[] | null => {
		const res = models()
		return res && Result.isOk(res) ? res.value : null
	}
	const loadError = (): string | null => {
		const res = models()
		return res && Result.isError(res) ? res.error.message : null
	}

	return (
		<Show
			when={!models.loading}
			fallback={<Loading message={t('globalSettings.loadingModels')} />}
		>
			<Show
				when={loaded()}
				fallback={
					<TextField
						id={id()}
						label={props.label}
						value={props.value}
						onInput={props.onChange}
						placeholder={props.configModel ?? props.placeholder}
						maxLength={200}
						autocomplete="off"
						hint={hint(
							t('globalSettings.modelsUnavailable', { error: loadError() ?? '' }),
						)}
					/>
				}
			>
				{(list: () => AiModelJson[]) => (
					<SelectField
						id={id()}
						label={props.label}
						value={props.value}
						onChange={props.onChange}
						options={modelOptions(list(), props.value)}
						emptyLabel={fallback()}
						hint={props.active ? hint() : undefined}
					/>
				)}
			</Show>
		</Show>
	)
}

/** Settings form; the fields start from the stored values. */
function SettingsForm(props: {
	settings: GlobalSettingsJson
	onSaved: (settings: GlobalSettingsJson) => void
}): JSX.Element {
	const [claudeModel, setClaudeModel] = createSignal(props.settings.ai_claude_model ?? '')
	const [opencodeModel, setOpencodeModel] = createSignal(props.settings.ai_opencode_model ?? '')
	const [cutoffDay, setCutoffDay] = createSignal(
		props.settings.billing_cutoff_day === null ? '' : String(props.settings.billing_cutoff_day),
	)
	const [error, setError] = createSignal<string | null>(null)
	const [saved, setSaved] = createSignal(false)
	const action = useAction(setError)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setSaved(false)
		const day = cutoffDay().trim() === '' ? null : Number(cutoffDay())
		if (day !== null && !(Number.isInteger(day) && day >= 1 && day <= 28)) {
			setError(t('billing.cutoffDayInvalid'))
			return
		}
		let next: GlobalSettingsJson | null = null
		const ok = await action.run(async () => {
			const res = await save_global_settings({
				ai_claude_model: claudeModel().trim() || null,
				ai_opencode_model: opencodeModel().trim() || null,
				billing_cutoff_day: day,
			})
			if (Result.isOk(res)) {
				next = res.value
			}
			return res
		})
		if (ok && next) {
			setSaved(true)
			props.onSaved(next)
		}
	}

	return (
		<div class="integration-settings">
			<form class="form-stacked" onSubmit={(e: SubmitEvent) => void handleSave(e)}>
				<SettingsSection
					title={t('globalSettings.sectionAi')}
					description={
						props.settings.config.ai_provider === null
							? t('globalSettings.aiNotConfigured')
							: t('globalSettings.sectionAiHint')
					}
				>
					<ModelField
						provider="claude"
						label={t('globalSettings.claudeModel')}
						value={claudeModel()}
						onChange={setClaudeModel}
						configModel={props.settings.config.ai_claude_model}
						active={props.settings.config.ai_provider === 'claude'}
						placeholder="claude-opus-5-5"
					/>
					<ModelField
						provider="opencode"
						label={t('globalSettings.opencodeModel')}
						value={opencodeModel()}
						onChange={setOpencodeModel}
						configModel={props.settings.config.ai_opencode_model}
						active={props.settings.config.ai_provider === 'opencode'}
						placeholder="anthropic/claude-opus-5-5"
					/>
				</SettingsSection>
				<SettingsSection
					title={t('globalSettings.sectionBilling')}
					description={t('globalSettings.sectionBillingHint')}
				>
					<TextField
						id="global-settings-billing-cutoff-day"
						label={t('billing.cutoffDay')}
						type="number"
						min={1}
						max={28}
						step={1}
						inputmode="numeric"
						value={cutoffDay()}
						onInput={setCutoffDay}
						placeholder={t('billing.cutoffDayPlaceholder')}
						hint={<Hint>{t('billing.cutoffDayHint')}</Hint>}
					/>
				</SettingsSection>
				<div class="form-actions">
					<button type="submit" disabled={action.pending()}>
						{action.pending() ? t('common.saving') : t('common.save')}
					</button>
					<Show when={saved() && !action.pending()}>
						<span class="text-success" role="status">
							{t('integration.saved')}
						</span>
					</Show>
				</div>
			</form>
			<InlineError message={error()} />
		</div>
	)
}

/** Global settings of the installation. */
export function GlobalSettingsPage(): JSX.Element {
	const [settings, { mutate }] = createResource(fetch_global_settings)
	const loaded = (): GlobalSettingsJson | null => {
		const res = settings()
		return res && Result.isOk(res) ? res.value : null
	}
	const loadError = (): string | null => {
		const res = settings()
		return res && Result.isError(res) ? res.error.message : null
	}

	return (
		<div class="settings-page">
			<div class="page-header">
				<h2>{t('globalSettings.title')}</h2>
			</div>
			<p class="page-subtitle">{t('globalSettings.subtitle')}</p>

			<Show
				when={loaded()}
				fallback={
					<Show
						when={settings.loading}
						fallback={<InlineError message={loadError()} alert />}
					>
						<Loading message={t('common.loading')} />
					</Show>
				}
			>
				{(value: () => GlobalSettingsJson) => (
					<SettingsForm
						settings={value()}
						onSaved={(next: GlobalSettingsJson) => mutate(Result.ok(next))}
					/>
				)}
			</Show>
		</div>
	)
}
