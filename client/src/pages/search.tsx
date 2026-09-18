import { Result } from 'better-result'
import type { JSX } from 'solid-js'
import { createEffect, createResource, createSignal, For, Show } from 'solid-js'
import {
	fetch_search,
	type SearchCable,
	type SearchDevice,
	type SearchRack,
	type SearchSite,
	type SearchTenant,
} from '../api_p6'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/** /search — grouped global search across tenants/sites/racks/devices/cables. */
export function SearchPage(props: { initial: string }): JSX.Element {
	const [query, setQuery] = createSignal(props.initial)
	const [error, setError] = createSignal<string | null>(null)

	// The nav search box can retarget this page without a remount.
	createEffect(() => {
		setQuery(props.initial)
	})

	const [result, { refetch }] = createResource(query, async (q: string) => {
		const trimmed = q.trim()
		if (!trimmed) {
			return null
		}
		const res = await fetch_search(trimmed)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	return (
		<div>
			<h2>Search</h2>
			<p class="page-subtitle">
				One query across tenants, sites, racks, devices, and cables.
			</p>
			<form
				onSubmit={(e: SubmitEvent): void => {
					e.preventDefault()
					setError(null)
					void refetch()
				}}
			>
				<input
					placeholder="Search tenants, sites, racks, devices, cables…"
					value={query()}
					onInput={(e: Event & { currentTarget: HTMLInputElement }) =>
						setQuery(e.currentTarget.value)
					}
					aria-label="Global search"
				/>
				<button type="submit">Search</button>
			</form>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
			<Show when={result()}>
				<h3>Tenants ({result()?.tenants.total ?? 0})</h3>
				<ul>
					<For each={result()?.tenants.items ?? []}>
						{(t: SearchTenant): JSX.Element => (
							<li>
								<a
									href="/tenants"
									onClick={(e: MouseEvent): void => go(e, '/tenants')}
								>
									{t.name}
								</a>{' '}
								<code>{t.slug}</code>
							</li>
						)}
					</For>
				</ul>
				<h3>Sites ({result()?.sites.total ?? 0})</h3>
				<ul>
					<For each={result()?.sites.items ?? []}>
						{(s: SearchSite): JSX.Element => (
							<li>
								<a
									href={`/sites/${s.id}`}
									onClick={(e: MouseEvent): void => go(e, `/sites/${s.id}`)}
								>
									{s.name}
								</a>{' '}
								<code>{s.slug}</code>
							</li>
						)}
					</For>
				</ul>
				<h3>Racks ({result()?.racks.total ?? 0})</h3>
				<ul>
					<For each={result()?.racks.items ?? []}>
						{(r: SearchRack): JSX.Element => (
							<li>
								<a
									href={`/racks/${r.id}`}
									onClick={(e: MouseEvent): void => go(e, `/racks/${r.id}`)}
								>
									{r.name}
								</a>{' '}
								<code>{r.slug}</code>
							</li>
						)}
					</For>
				</ul>
				<h3>Devices ({result()?.devices.total ?? 0})</h3>
				<ul>
					<For each={result()?.devices.items ?? []}>
						{(d: SearchDevice): JSX.Element => (
							<li>
								<a
									href={`/devices/${d.id}`}
									onClick={(e: MouseEvent): void => go(e, `/devices/${d.id}`)}
								>
									{d.name}
								</a>{' '}
								{d.asset_tag ? <code>{d.asset_tag}</code> : null}
							</li>
						)}
					</For>
				</ul>
				<h3>Cables ({result()?.cables.total ?? 0})</h3>
				<ul>
					<For each={result()?.cables.items ?? []}>
						{(c: SearchCable): JSX.Element => (
							<li>
								<code>{c.label ?? c.id.slice(0, 8)}</code>{' '}
								{c.kind ? <span>({c.kind})</span> : null}
							</li>
						)}
					</For>
				</ul>
			</Show>
		</div>
	)
}
