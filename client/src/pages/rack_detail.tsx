import { Result } from 'better-result'
import type { ElevationUnit, InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import { create_shelf, delete_shelf, fetch_elevation, fetch_rack } from '../api_p2'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /racks/:id — elevation view (top-down U list). Shelves render as spanning
 * blocks (every covered U labelled with the shelf name); free U rows carry
 * a placeholder affordance that P4 wires to device placement.
 */
export function RackDetailPage(props: { id: string }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [shelfName, setShelfName] = createSignal('')
	const [shelfU, setShelfU] = createSignal('')
	const [pendingU, setPendingU] = createSignal<number | null>(null)

	const [rack] = createResource(async () => {
		const res = await fetch_rack(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [elevation, { refetch }] = createResource(async () => {
		const res = await fetch_elevation(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})

	async function handleCreateShelf(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const position = Number(shelfU())
		if (!Number.isInteger(position) || position < 1) {
			setError('Shelf position must be a positive U number')
			return
		}
		const res = await create_shelf({
			name: shelfName(),
			rack_id: props.id,
			position_u: position,
		})
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setShelfName('')
		setShelfU('')
		setPendingU(null)
		void refetch()
	}

	async function handleDeleteShelf(id: string): Promise<void> {
		setError(null)
		const res = await delete_shelf(id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetch()
	}

	return (
		<div>
			<p>
				<a href="/sites" onClick={(e: MouseEvent): void => go(e, '/sites')}>
					← Sites
				</a>
			</p>
			<Show when={rack()} fallback={<p>Loading rack…</p>}>
				<h2>
					{rack()?.name} <code>{rack()?.slug}</code> <span>{rack()?.height_u}U</span>
				</h2>
			</Show>
			<h3>Add shelf</h3>
			<form onSubmit={handleCreateShelf}>
				<input
					placeholder="Name"
					value={shelfName()}
					onInput={(e: InputEventAndTarget) => setShelfName(e.currentTarget.value)}
				/>
				<input
					placeholder="U position"
					inputmode="numeric"
					value={shelfU()}
					onInput={(e: InputEventAndTarget) => setShelfU(e.currentTarget.value)}
				/>
				<button type="submit">Add shelf</button>
			</form>
			<h3>Elevation</h3>
			<Show when={elevation()} fallback={<p>Loading elevation…</p>}>
				<table>
					<thead>
						<tr>
							<th>U</th>
							<th>Occupant</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						<For each={elevation()?.units ?? []}>
							{(unit: ElevationUnit) => (
								<tr>
									<td>
										<code>U{unit.u}</code>
									</td>
									<td>
										<Show when={unit.shelf} fallback={<span>free</span>}>
											<span>▤ {unit.shelf?.name} (shelf)</span>
										</Show>
									</td>
									<td>
										<Show
											when={unit.shelf}
											fallback={
												<button
													type="button"
													title="Device placement arrives in P4"
													onClick={() => {
														setPendingU(unit.u)
														setShelfU(String(unit.u))
													}}
												>
													Place here
												</button>
											}
										>
											<button
												type="button"
												onClick={() =>
													handleDeleteShelf(unit.shelf?.id ?? '')
												}
											>
												Delete shelf
											</button>
										</Show>
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</Show>
			<Show when={pendingU() !== null}>
				<p>
					U{pendingU()} selected — device placement arrives in P4; use the form above to
					add a shelf at this U.
				</p>
			</Show>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
