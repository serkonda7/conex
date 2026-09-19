import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { Accessor, JSX } from 'solid-js'
import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import {
	create_location,
	delete_location,
	fetch_locations,
	fetch_site,
	type LocationRow,
	type SiteRow,
} from '../api_p1'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

interface TreeNode {
	row: LocationRow
	children: TreeNode[]
}

/** Nests the flat location list into a forest ordered by name. */
function buildTree(rows: LocationRow[]): TreeNode[] {
	const byId = new Map<number, TreeNode>()
	for (const row of rows) {
		byId.set(row.id, { row, children: [] })
	}
	const roots: TreeNode[] = []
	for (const node of byId.values()) {
		const parent = node.row.parent_id ? byId.get(node.row.parent_id) : undefined
		if (parent) {
			parent.children.push(node)
		} else {
			roots.push(node)
		}
	}
	const byName = (a: TreeNode, b: TreeNode): number => a.row.name.localeCompare(b.row.name)
	for (const node of byId.values()) {
		node.children.sort(byName)
	}
	roots.sort(byName)
	return roots
}

function LocationBranch(props: {
	node: TreeNode
	trail: string[]
	onDelete: (id: number) => void
}): JSX.Element {
	const trail = [...props.trail, props.node.row.name]
	return (
		<li>
			<code>{trail.join(' > ')}</code>{' '}
			<button
				type="button"
				class="btn-danger"
				onClick={() => props.onDelete(props.node.row.id)}
			>
				Delete
			</button>
			<Show when={props.node.children.length > 0}>
				<ul>
					<For each={props.node.children}>
						{(child: TreeNode): JSX.Element => (
							<LocationBranch node={child} trail={trail} onDelete={props.onDelete} />
						)}
					</For>
				</ul>
			</Show>
		</li>
	)
}

/** /sites/:id — site detail with the location tree and per-node breadcrumbs. */
export function SiteDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [name, setName] = createSignal('')
	const [slug, setSlug] = createSignal('')
	const [parentId, setParentId] = createSignal('')

	const [site] = createResource(async () => {
		const res = await fetch_site(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return null
		}
		return res.value
	})
	const [locations, { refetch }] = createResource(async () => {
		const res = await fetch_locations(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const tree = createMemo(() => buildTree(locations() ?? []))

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await create_location(
			name(),
			slug(),
			props.id,
			parentId() ? Number(parentId()) : null,
		)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setName('')
		setSlug('')
		setParentId('')
		void refetch()
	}

	async function handleDelete(id: number): Promise<void> {
		setError(null)
		const res = await delete_location(id)
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
			<Show when={site()} fallback={<p class="skeleton">Loading site…</p>}>
				{(s: Accessor<SiteRow>): JSX.Element => (
					<h2>
						{s().name} <code>{s().slug}</code>
					</h2>
				)}
			</Show>
			<h3>Add location</h3>
			<form onSubmit={handleCreate}>
				<input
					placeholder="Name"
					value={name()}
					onInput={(e: InputEventAndTarget) => setName(e.currentTarget.value)}
				/>
				<input
					placeholder="slug"
					value={slug()}
					onInput={(e: InputEventAndTarget) => setSlug(e.currentTarget.value)}
				/>
				<select
					value={parentId()}
					onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
						setParentId(e.currentTarget.value)
					}
				>
					<option value="">Top level</option>
					<For each={locations() ?? []}>
						{(l: LocationRow): JSX.Element => <option value={l.id}>{l.name}</option>}
					</For>
				</select>
				<button type="submit">Add location</button>
			</form>
			<h3>Locations</h3>
			<Show when={tree().length > 0} fallback={<p class="empty">No locations yet.</p>}>
				<ul>
					<For each={tree()}>
						{(node: TreeNode): JSX.Element => (
							<LocationBranch
								node={node}
								trail={[site()?.name ?? 'site']}
								onDelete={handleDelete}
							/>
						)}
					</For>
				</ul>
			</Show>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
