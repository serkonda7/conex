import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import { type AuditRow, fetch_audit } from '../api_p6'

/** /audit — audit log list, newest first, with substring search. */
export function AuditPage(): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [search, setSearch] = createSignal('')
	const [page, setPage] = createSignal(1)

	const [log, { refetch }] = createResource(
		() => ({ search: search(), page: page() }),
		async (params: { search: string; page: number }) => {
			const res = await fetch_audit(params.search, String(params.page), '50')
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			return res.value
		},
	)

	return (
		<div>
			<h2>Audit log</h2>
			<form
				onSubmit={(e: SubmitEvent): void => {
					e.preventDefault()
					setError(null)
					setPage(1)
					void refetch()
				}}
			>
				<input
					placeholder="Search action, user, resource…"
					value={search()}
					onInput={(e: InputEventAndTarget) => setSearch(e.currentTarget.value)}
					aria-label="Audit search"
				/>
				<button type="submit">Filter</button>
			</form>
			<table>
				<thead>
					<tr>
						<th>Time</th>
						<th>Action</th>
						<th>User</th>
						<th>Resource</th>
					</tr>
				</thead>
				<tbody>
					<For each={log()?.items ?? []}>
						{(entry: AuditRow): JSX.Element => (
							<tr>
								<td>{new Date(entry.created_at * 1000).toISOString()}</td>
								<td>
									<code>{entry.action}</code>
								</td>
								<td>{entry.user_email}</td>
								<td>
									{entry.resource_id ? (
										<code>{entry.resource_id.slice(0, 8)}</code>
									) : (
										'—'
									)}
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
			<p>
				Total: {log()?.total ?? 0} · Page {log()?.page ?? 1}
			</p>
			<p>
				<button
					type="button"
					disabled={page() <= 1}
					onClick={() => {
						setPage(page() - 1)
					}}
				>
					← Prev
				</button>{' '}
				<button
					type="button"
					onClick={() => {
						setPage(page() + 1)
					}}
				>
					Next →
				</button>
			</p>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
