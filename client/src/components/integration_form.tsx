/**
 * Credential fields shared by the integration add and edit forms,
 * plus the "Test connection" check. Secrets are write-only: the edit form
 * leaves them empty and blank means "keep the stored value".
 */
import { Result } from 'better-result'
import { createSignal, type JSX, type Setter, Show } from 'solid-js'
import { type IntegrationProvider, test_integration } from '../api_integrations'
import { t } from '../i18n'
import { Field, Hint, TextField } from './form'

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

export function IntegrationFormFields(props: {
	provider: IntegrationProvider
	form: IntegrationFormState
	/** Edit form: secrets may stay empty to keep the stored ones. */
	editing: boolean
}): JSX.Element {
	const f = props.form
	const [testing, setTesting] = createSignal(false)
	const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null)

	async function handleTest(): Promise<void> {
		setTesting(true)
		setTestResult(null)
		const res = await test_integration(props.provider, {
			base_url: f.baseUrl().trim(),
			username: f.username().trim(),
			...(f.password() !== '' ? { password: f.password() } : {}),
			...(f.erpToken() !== '' ? { erp_token: f.erpToken() } : {}),
		})
		setTesting(false)
		setTestResult(
			Result.isError(res)
				? { ok: false, message: res.error.message }
				: { ok: true, message: t('integration.testOk') },
		)
	}

	return (
		<>
			<TextField
				id="integration-base-url"
				label={t('integration.baseUrl')}
				required
				placeholder="https://tanss.example.com"
				maxLength={500}
				autocomplete="off"
				autofocus={!props.editing}
				value={f.baseUrl()}
				onInput={f.setBaseUrl}
			/>
			<TextField
				id="integration-username"
				label={t('integration.username')}
				required
				maxLength={200}
				autocomplete="off"
				value={f.username()}
				onInput={f.setUsername}
				hint={<Hint>{t('integration.usernameHint')}</Hint>}
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
				<Show when={testResult()}>
					{(result: () => { ok: boolean; message: string }) => (
						<p
							class={result().ok ? 'text-success' : 'text-danger'}
							role={result().ok ? 'status' : 'alert'}
						>
							{result().message}
						</p>
					)}
				</Show>
			</Field>
		</>
	)
}
