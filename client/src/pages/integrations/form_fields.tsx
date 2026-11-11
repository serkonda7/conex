/**
 * Credential fields shared by the integration add and edit forms, per
 * provider, plus the "Test connection" check. Secrets are write-only: the
 * edit form leaves them empty and blank means "keep the stored value".
 */
import { Result } from 'better-result'
import type { IntegrationCreate, IntegrationTest, IntegrationUpdate } from 'shared/src/schemas'
import { createSignal, type JSX, type Setter, Show } from 'solid-js'
import {
	type IntegrationJson,
	type IntegrationProvider,
	test_integration,
} from '../../api/integrations'
import { Field, Hint, SelectField, TextField } from '../../components/form'
import { t } from '../../i18n'

export interface IntegrationFormState {
	baseUrl: () => string
	setBaseUrl: Setter<string>
	username: () => string
	setUsername: Setter<string>
	password: () => string
	setPassword: Setter<string>
	erpToken: () => string
	setErpToken: Setter<string>
	clientId: () => string
	setClientId: Setter<string>
	homeTenant: () => string
	setHomeTenant: Setter<string>
	clientSecret: () => string
	setClientSecret: Setter<string>
	/** `'1'` / `'0'` (select value). */
	licensedOnly: () => string
	setLicensedOnly: Setter<string>
	secretExpires: () => string
	setSecretExpires: Setter<string>
}

export function useIntegrationForm(): IntegrationFormState {
	const [baseUrl, setBaseUrl] = createSignal('')
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [erpToken, setErpToken] = createSignal('')
	const [clientId, setClientId] = createSignal('')
	const [homeTenant, setHomeTenant] = createSignal('')
	const [clientSecret, setClientSecret] = createSignal('')
	const [licensedOnly, setLicensedOnly] = createSignal('1')
	const [secretExpires, setSecretExpires] = createSignal('')
	return {
		baseUrl,
		setBaseUrl,
		username,
		setUsername,
		password,
		setPassword,
		erpToken,
		setErpToken,
		clientId,
		setClientId,
		homeTenant,
		setHomeTenant,
		clientSecret,
		setClientSecret,
		licensedOnly,
		setLicensedOnly,
		secretExpires,
		setSecretExpires,
	}
}

/** Fills the form from a stored integration (secrets stay empty). */
export function fillIntegrationForm(form: IntegrationFormState, row: IntegrationJson): void {
	form.setBaseUrl(row.base_url ?? '')
	form.setUsername(row.username ?? '')
	const settings = row.settings
	form.setClientId(typeof settings.client_id === 'string' ? settings.client_id : '')
	form.setHomeTenant(typeof settings.home_tenant === 'string' ? settings.home_tenant : '')
	form.setLicensedOnly(settings.licensed_only === false ? '0' : '1')
	form.setSecretExpires(
		typeof settings.secret_expires === 'string' ? settings.secret_expires : '',
	)
}

/** Value of a secret field, left out when blank (keep the stored value). */
function secret<K extends string>(key: K, value: string): Partial<Record<K, string>> {
	return value !== '' ? ({ [key]: value } as Record<K, string>) : {}
}

/** Client-side check of the add form; null when complete. */
export function validateIntegrationForm(
	provider: IntegrationProvider,
	form: IntegrationFormState,
): string | null {
	if (provider === 'm365') {
		if (form.clientId().trim() === '') {
			return t('m365.clientIdRequired')
		}
		if (form.homeTenant().trim() === '') {
			return t('m365.homeTenantRequired')
		}
		return form.clientSecret() === '' ? t('m365.clientSecretRequired') : null
	}
	if (form.baseUrl().trim() === '') {
		return t('integration.baseUrlRequired')
	}
	if (form.username().trim() === '') {
		return t('auth.usernameRequired')
	}
	if (form.password() === '') {
		return t('auth.passwordRequired')
	}
	return form.erpToken() === '' ? t('integration.erpTokenRequired') : null
}

/** Body of "Test connection"; blank secrets fall back to the stored ones. */
function testBody(provider: IntegrationProvider, f: IntegrationFormState): IntegrationTest {
	if (provider === 'm365') {
		return {
			provider,
			client_id: f.clientId().trim(),
			home_tenant: f.homeTenant().trim(),
			licensed_only: f.licensedOnly() === '1',
			secret_expires: f.secretExpires(),
			...secret('client_secret', f.clientSecret()),
		}
	}
	return {
		provider,
		base_url: f.baseUrl().trim(),
		username: f.username().trim(),
		...secret('password', f.password()),
		...secret('erp_token', f.erpToken()),
	}
}

/** Create body of the add form (validated with {@link validateIntegrationForm} first). */
export function createBody(
	provider: IntegrationProvider,
	f: IntegrationFormState,
): IntegrationCreate {
	if (provider === 'm365') {
		return {
			provider,
			client_id: f.clientId().trim(),
			home_tenant: f.homeTenant().trim(),
			licensed_only: f.licensedOnly() === '1',
			secret_expires: f.secretExpires(),
			client_secret: f.clientSecret(),
		}
	}
	return {
		provider,
		base_url: f.baseUrl().trim(),
		username: f.username().trim(),
		password: f.password(),
		erp_token: f.erpToken(),
	}
}

/** Patch body of the edit form; blank secrets keep the stored ones. */
export function updateBody(
	provider: IntegrationProvider,
	f: IntegrationFormState,
	enabled: boolean,
): IntegrationUpdate {
	if (provider === 'm365') {
		return {
			provider,
			client_id: f.clientId().trim(),
			home_tenant: f.homeTenant().trim(),
			licensed_only: f.licensedOnly() === '1',
			secret_expires: f.secretExpires(),
			...secret('client_secret', f.clientSecret()),
			enabled,
		}
	}
	return {
		provider,
		base_url: f.baseUrl().trim(),
		username: f.username().trim(),
		...secret('password', f.password()),
		...secret('erp_token', f.erpToken()),
		enabled,
	}
}

function TanssFields(props: { form: IntegrationFormState; editing: boolean }): JSX.Element {
	const f = props.form
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
		</>
	)
}

function M365Fields(props: { form: IntegrationFormState; editing: boolean }): JSX.Element {
	const f = props.form
	return (
		<>
			<TextField
				id="integration-client-id"
				label={t('m365.clientId')}
				required
				placeholder="00000000-0000-0000-0000-000000000000"
				maxLength={36}
				autocomplete="off"
				autofocus={!props.editing}
				value={f.clientId()}
				onInput={f.setClientId}
				hint={<Hint>{t('m365.clientIdHint')}</Hint>}
			/>
			<TextField
				id="integration-home-tenant"
				label={t('m365.homeTenant')}
				required
				placeholder="msp.onmicrosoft.com"
				maxLength={253}
				autocomplete="off"
				value={f.homeTenant()}
				onInput={f.setHomeTenant}
				hint={<Hint>{t('m365.homeTenantHint')}</Hint>}
			/>
			<TextField
				id="integration-client-secret"
				label={t('m365.clientSecret')}
				type="password"
				required={!props.editing}
				placeholder={props.editing ? t('integration.keepSecret') : undefined}
				autocomplete="off"
				value={f.clientSecret()}
				onInput={f.setClientSecret}
			/>
			<TextField
				id="integration-secret-expires"
				label={t('m365.secretExpires')}
				type="date"
				value={f.secretExpires()}
				onInput={f.setSecretExpires}
				hint={<Hint>{t('m365.secretExpiresHint')}</Hint>}
			/>
			<SelectField
				id="integration-licensed-only"
				label={t('m365.licensedOnly')}
				value={f.licensedOnly()}
				onChange={f.setLicensedOnly}
				options={[
					{ value: '1', label: t('common.yes') },
					{ value: '0', label: t('common.no') },
				]}
				hint={<Hint>{t('m365.licensedOnlyHint')}</Hint>}
			/>
		</>
	)
}

export function IntegrationFormFields(props: {
	provider: IntegrationProvider
	form: IntegrationFormState
	/** Edit form: secrets may stay empty to keep the stored ones. */
	editing: boolean
}): JSX.Element {
	const [testing, setTesting] = createSignal(false)
	const [testResult, setTestResult] = createSignal<{ ok: boolean; message: string } | null>(null)

	async function handleTest(): Promise<void> {
		setTesting(true)
		setTestResult(null)
		const res = await test_integration(props.provider, testBody(props.provider, props.form))
		setTesting(false)
		setTestResult(
			Result.isError(res)
				? { ok: false, message: res.error.message }
				: {
						ok: true,
						message:
							props.provider === 'm365' ? t('m365.testOk') : t('integration.testOk'),
					},
		)
	}

	return (
		<>
			<Show
				when={props.provider === 'm365'}
				fallback={<TanssFields form={props.form} editing={props.editing} />}
			>
				<M365Fields form={props.form} editing={props.editing} />
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
