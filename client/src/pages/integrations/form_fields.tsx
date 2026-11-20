/**
 * Credential fields shared by the integration add and edit forms,
 * plus the "Test connection" check. Secrets are write-only: the edit form
 * leaves them empty and blank means "keep the stored value".
 */
import { Result } from 'better-result'
import { providerNeedsErpToken } from 'shared/src/schemas'
import { createSignal, type JSX, type Setter, Show } from 'solid-js'
import { type IntegrationProvider, test_integration } from '../../api/integrations'
import { Field, Hint, TextField } from '../../components/form'
import { t } from '../../i18n'
import { providerUsesMailLogin } from './provider_capabilities'

export interface IntegrationFormState {
	baseUrl: () => string
	setBaseUrl: Setter<string>
	username: () => string
	setUsername: Setter<string>
	password: () => string
	setPassword: Setter<string>
	erpToken: () => string
	setErpToken: Setter<string>
}

export function useIntegrationForm(): IntegrationFormState {
	const [baseUrl, setBaseUrl] = createSignal('')
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [erpToken, setErpToken] = createSignal('')
	return {
		baseUrl,
		setBaseUrl,
		username,
		setUsername,
		password,
		setPassword,
		erpToken,
		setErpToken,
	}
}

/** Secrets typed into the form; blank ones are left out (keep the stored value). */
export function secrets(
	form: IntegrationFormState,
	provider: IntegrationProvider,
): { password?: string; erp_token?: string } {
	return {
		...(form.password() !== '' ? { password: form.password() } : {}),
		...(providerNeedsErpToken(provider) && form.erpToken() !== ''
			? { erp_token: form.erpToken() }
			: {}),
	}
}

/** Outcome of a connection test. */
export interface TestResult {
	ok: boolean
	message: string
}

/** Connection test outcome under the test button; nothing before a test. */
export function TestResultLine(props: { result: TestResult | null }): JSX.Element {
	return (
		<Show when={props.result}>
			{(result: () => TestResult) => (
				<p
					class={result().ok ? 'text-success' : 'text-danger'}
					role={result().ok ? 'status' : 'alert'}
				>
					{result().message}
				</p>
			)}
		</Show>
	)
}

export function IntegrationFormFields(props: {
	provider: IntegrationProvider
	form: IntegrationFormState
	/** Edit form: secrets may stay empty to keep the stored ones. */
	editing: boolean
}): JSX.Element {
	const f = props.form
	const [testing, setTesting] = createSignal(false)
	const [testResult, setTestResult] = createSignal<TestResult | null>(null)

	async function handleTest(): Promise<void> {
		setTesting(true)
		setTestResult(null)
		const res = await test_integration(props.provider, {
			base_url: f.baseUrl().trim(),
			username: f.username().trim(),
			...secrets(f, props.provider),
		})
		setTesting(false)
		setTestResult(
			Result.isError(res)
				? { ok: false, message: res.error.message }
				: {
						ok: true,
						message: t(
							providerNeedsErpToken(props.provider)
								? 'integration.testOk'
								: 'integration.testOkNoErp',
						),
					},
		)
	}

	return (
		<>
			<TextField
				id="integration-base-url"
				label={t('integration.baseUrl')}
				required
				placeholder={
					props.provider === 'octoja'
						? 'https://acme.eu1.octoja.cloud'
						: 'https://tanss.example.com'
				}
				maxLength={500}
				autocomplete="off"
				autofocus={!props.editing}
				value={f.baseUrl()}
				onInput={f.setBaseUrl}
			/>
			<TextField
				id="integration-username"
				label={
					providerUsesMailLogin(props.provider)
						? t('integration.mailAddress')
						: t('integration.username')
				}
				required
				maxLength={200}
				autocomplete="off"
				value={f.username()}
				onInput={f.setUsername}
				hint={
					providerUsesMailLogin(props.provider) ? (
						<Hint>{t('integration.mailAddressHint')}</Hint>
					) : (
						<Hint>{t('integration.usernameHint')}</Hint>
					)
				}
			/>
			<TextField
				id="integration-password"
				label={t('auth.password')}
				type="password"
				required={!props.editing}
				placeholder={props.editing ? t('integration.keepSecret') : undefined}
				autocomplete="new-password"
				value={f.password()}
				onInput={f.setPassword}
			/>
			<Show when={providerNeedsErpToken(props.provider)}>
				<TextField
					id="integration-erp-token"
					label={t('integration.erpToken')}
					type="password"
					required={!props.editing}
					placeholder={props.editing ? t('integration.keepSecret') : 'Bearer …'}
					autocomplete="off"
					value={f.erpToken()}
					onInput={f.setErpToken}
					hint={<Hint>{t('integration.erpTokenHint')}</Hint>}
				/>
			</Show>
			<Field label={t('integration.connection')} for="integration-test">
				<div>
					<button
						id="integration-test"
						type="button"
						disabled={testing()}
						onClick={() => void handleTest()}
					>
						{testing() ? t('integration.testing') : t('integration.test')}
					</button>
				</div>
				<TestResultLine result={testResult()} />
			</Field>
		</>
	)
}
