/**
 * Sign-in gate: the login form, or the first-run form that creates the
 * admin account on a fresh database.
 */
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import { createSignal, type JSX } from 'solid-js'
import { fetchMe, login, type SessionUser, setupAdmin } from '../api/auth'
import { InlineError } from '../components/feedback'
import { t } from '../i18n'

export const APP_TITLE = 'CoNetBox'

/** Placeholder-labelled input with a visually hidden `<label>`. */
function AuthInput(props: {
	id: string
	label: string
	type: 'text' | 'password'
	autocomplete: string
	value: string
	onInput: (value: string) => void
}): JSX.Element {
	return (
		<>
			<label class="visually-hidden" for={props.id}>
				{props.label}
			</label>
			<input
				id={props.id}
				type={props.type}
				placeholder={props.label}
				aria-label={props.label}
				required
				value={props.value}
				onInput={(e: InputEventAndTarget) => props.onInput(e.currentTarget.value)}
				autocomplete={props.autocomplete}
			/>
		</>
	)
}

/** Centered page with the app title above the form. */
function AuthShell(props: { children: JSX.Element }): JSX.Element {
	return (
		<main class="app-content app-content--centered">
			<div class="app-auth">
				<div class="app-header">
					<h1>{APP_TITLE}</h1>
				</div>
				{props.children}
			</div>
		</main>
	)
}

export function LoginPage(props: { onLogin: (user: SessionUser) => void }): JSX.Element {
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)

	async function handleLogin(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await login(username(), password())
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setPassword('')
		const fallback: SessionUser = {
			username: username().trim(),
			role: 'viewer',
			tenant_id: null,
		}
		props.onLogin((await fetchMe()) ?? fallback)
	}

	return (
		<AuthShell>
			<form onSubmit={handleLogin}>
				<AuthInput
					id="login-username"
					label={t('auth.username')}
					type="text"
					autocomplete="username"
					value={username()}
					onInput={setUsername}
				/>
				<AuthInput
					id="login-password"
					label={t('auth.password')}
					type="password"
					autocomplete="current-password"
					value={password()}
					onInput={setPassword}
				/>
				<button type="submit">{t('auth.login')}</button>
				<InlineError message={error()} alert />
			</form>
		</AuthShell>
	)
}

export function SetupPage(props: {
	onDone: (user: SessionUser) => void
	/** Another request finished setup first: fall back to the login form. */
	onAlreadyDone: () => void
}): JSX.Element {
	const [username, setUsername] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [confirm, setConfirm] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)

	function invalid(name: string): string | null {
		if (!name) {
			return t('auth.usernameRequired')
		}
		if (!password()) {
			return t('auth.passwordRequired')
		}
		return password() === confirm() ? null : t('auth.passwordMismatch')
	}

	async function handleSetup(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const name = username().trim()
		const problem = invalid(name)
		setError(problem)
		if (problem !== null) {
			return
		}
		const res = await setupAdmin(name, password())
		if (Result.isError(res)) {
			// A 409 means another request finished setup first.
			if (res.error.message.toLowerCase().includes('already completed')) {
				props.onAlreadyDone()
			}
			setError(res.error.message)
			return
		}
		props.onDone({ username: name, role: 'admin', tenant_id: null })
	}

	return (
		<AuthShell>
			<section aria-label={t('auth.setup')}>
				<h2>{t('auth.welcome')}</h2>
				<p class="page-subtitle">{t('auth.setupIntro')}</p>
				<form onSubmit={handleSetup}>
					<AuthInput
						id="setup-username"
						label={t('auth.adminUsername')}
						type="text"
						autocomplete="username"
						value={username()}
						onInput={setUsername}
					/>
					<AuthInput
						id="setup-password"
						label={t('auth.password')}
						type="password"
						autocomplete="new-password"
						value={password()}
						onInput={setPassword}
					/>
					<AuthInput
						id="setup-confirm"
						label={t('auth.confirmPassword')}
						type="password"
						autocomplete="new-password"
						value={confirm()}
						onInput={setConfirm}
					/>
					<button type="submit">{t('auth.createAdmin')}</button>
					<InlineError message={error()} alert />
				</form>
			</section>
		</AuthShell>
	)
}
