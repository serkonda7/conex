import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import { createResource, createSignal, type JSX, Match, onMount, Show, Switch } from 'solid-js'
import { fetch_health, set_unauthorized_handler } from './api'
import { fetchMe, login, logout } from './api_auth'

// P0 scaffold shell: proves the typed `hc` fetcher, the session cookie flow
// and the minimal router wiring work. Domain pages arrive in P1-P6.
function App(): JSX.Element {
	const [isLoggedIn, setIsLoggedIn] = createSignal<boolean | null>(null)
	const [health, setHealth] = createSignal<string>('…')
	const [email, setEmail] = createSignal('')
	const [password, setPassword] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)

	const [meEmail, { refetch: refetchMe }] = createResource(isLoggedIn, async (loggedIn) => {
		if (!loggedIn) {
			return null
		}
		return email() || 'signed in'
	})

	onMount(async () => {
		setIsLoggedIn(await fetchMe())
		const res = await fetch_health()
		if (Result.isError(res)) {
			setHealth(`unreachable: ${res.error.message}`)
		} else {
			setHealth(`${res.value.status} (v${res.value.version})`)
		}
	})

	// A 401 can answer any request once the server session timed out
	set_unauthorized_handler(() => {
		setIsLoggedIn(false)
	})

	async function handleLogin(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await login(email(), password())
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setPassword('')
		setIsLoggedIn(true)
		void refetchMe()
	}

	async function handleLogout(): Promise<void> {
		await logout()
		setIsLoggedIn(false)
		setEmail('')
	}

	return (
		<main>
			<h1>Conex</h1>
			<p>
				Server health: <code>{health()}</code>
			</p>
			<Show when={isLoggedIn() !== null} fallback={<p>Loading…</p>}>
				<Switch>
					<Match when={isLoggedIn()}>
						<p>Signed in as {meEmail() ?? '…'}</p>
						<button type="button" onClick={handleLogout}>
							Sign out
						</button>
					</Match>
					<Match when={!isLoggedIn()}>
						<form onSubmit={handleLogin}>
							<input
								type="email"
								placeholder="Email"
								value={email()}
								onInput={(e: InputEventAndTarget) =>
									setEmail(e.currentTarget.value)
								}
								autocomplete="username"
							/>
							<input
								type="password"
								placeholder="Password"
								value={password()}
								onInput={(e: InputEventAndTarget) =>
									setPassword(e.currentTarget.value)
								}
								autocomplete="current-password"
							/>
							<button type="submit">Sign in</button>
						</form>
						<Show when={error()}>
							<div class="app-inline-error">{error()}</div>
						</Show>
					</Match>
				</Switch>
			</Show>
		</main>
	)
}

export default App
