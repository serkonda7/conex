import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { IconPencil, IconTrash } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For, Show } from 'solid-js'
import {
	create_stub,
	delete_device_type,
	delete_stub,
	fetch_adhoc_preview,
	fetch_device_type,
	fetch_manufacturers,
	fetch_stubs,
	fetch_type_preview,
	type StubRow,
} from '../api_p3'
import { type DeviceRow, fetch_devices } from '../api_p4'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

/**
 * /device-types/:id — device-type detail: header with model/slug, detail
 * grid (manufacturer, U height, description), the interface-stub editor with
 * the expanded interface-name preview, and the devices using this type.
 */
export function DeviceTypeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [stubPrefix, setStubPrefix] = createSignal('')
	const [stubCount, setStubCount] = createSignal('24')
	const [previewNames, setPreviewNames] = createSignal<string[]>([])

	const [deviceType] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_device_type(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
			void refreshPreview(id)
			return res.value
		},
	)
	const [manufacturers] = createResource(async () => {
		const res = await fetch_manufacturers({})
		if (Result.isError(res)) {
			setError(res.error.message)
			return []
		}
		return res.value.items
	})
	const [stubs, { refetch: refetchStubs }] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_stubs(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value
		},
	)
	const [devices] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_devices()
			if (Result.isError(res)) {
				setError(res.error.message)
				return []
			}
			return res.value.items.filter((d) => d.device_type_id === id)
		},
	)

	function mfrNameOf(id: number | undefined): string {
		if (id === undefined) {
			return '—'
		}
		return manufacturers()?.find((m) => m.id === id)?.name ?? String(id)
	}

	async function refreshPreview(typeId: number): Promise<void> {
		const res = await fetch_type_preview(typeId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setPreviewNames(res.value.interfaces.map((i) => i.name))
	}

	async function handleCreateStub(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const count = Number(stubCount())
		if (!Number.isInteger(count) || count < 1) {
			setError('Stub count must be an integer of at least 1')
			return
		}
		const res = await create_stub(props.id, { prefix: stubPrefix(), count })
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setStubPrefix('')
		setStubCount('24')
		void refetchStubs()
		void refreshPreview(props.id)
	}

	async function handleAdhocPreview(): Promise<void> {
		setError(null)
		const count = Number(stubCount())
		if (!stubPrefix() || !Number.isInteger(count) || count < 1) {
			setError('Enter a prefix and a count of at least 1 to preview')
			return
		}
		const res = await fetch_adhoc_preview(stubPrefix(), count)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setPreviewNames(res.value.interfaces.map((i) => i.name))
	}

	async function handleDeleteStub(stubId: number): Promise<void> {
		setError(null)
		const res = await delete_stub(props.id, stubId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetchStubs()
		void refreshPreview(props.id)
	}

	async function handleDelete(): Promise<void> {
		const t = deviceType()
		if (!t) {
			return
		}
		if (!window.confirm(`Delete device type "${t.model}"?`)) {
			return
		}
		setError(null)
		const res = await delete_device_type(props.id)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		navigate('/device-types')
	}

	const stubColumns: DataTableColumn<StubRow>[] = [
		{
			key: 'prefix',
			label: 'Prefix',
			getValue: (s: StubRow): JSX.Element => <code>{s.prefix}</code>,
		},
		{ key: 'count', label: 'Count', getValue: (s: StubRow): number => s.count },
		{ key: 'kind', label: 'Kind', getValue: (s: StubRow): string => s.kind },
	]

	const stubCountText = (): number => stubs()?.length ?? 0
	const deviceCount = (): number => devices()?.length ?? 0

	return (
		<div>
			<p>
				<a href="/device-types" onClick={(e: MouseEvent): void => go(e, '/device-types')}>
					← Device types
				</a>
			</p>
			<Show
				when={!deviceType.loading}
				fallback={<p class="skeleton">Loading device type…</p>}
			>
				<Show when={deviceType()} fallback={<p class="empty">Device type not found.</p>}>
					<div class="page-header">
						<h2>
							{deviceType()?.model} <code>{deviceType()?.slug}</code>
						</h2>
						<div class="form-actions">
							<button
								type="button"
								onClick={() => navigate(`/device-types/${props.id}/edit`)}
							>
								<span aria-hidden="true" class="app-nav-icon">
									<IconPencil size={14} />
								</span>{' '}
								Edit
							</button>
							<button type="button" class="btn-danger" onClick={handleDelete}>
								<span aria-hidden="true" class="app-nav-icon">
									<IconTrash size={14} />
								</span>{' '}
								Delete
							</button>
						</div>
					</div>
					<p class="page-subtitle">{deviceType()?.description || 'No description.'}</p>

					<section class="card" aria-label="Device type details">
						<dl class="detail-grid">
							<dt>Manufacturer</dt>
							<dd>{mfrNameOf(deviceType()?.manufacturer_id)}</dd>
							<dt>Slug</dt>
							<dd>
								<code>{deviceType()?.slug}</code>
							</dd>
							<dt>U height</dt>
							<dd>
								{deviceType()?.u_height === 0
									? '0 (virtual)'
									: `${deviceType()?.u_height}U`}
							</dd>
							<dt>Description</dt>
							<dd>{deviceType()?.description || '—'}</dd>
						</dl>
					</section>
				</Show>
			</Show>

			<h3 id="device-type-stubs">Interface stubs ({stubCountText()})</h3>
			<form onSubmit={handleCreateStub}>
				<input
					placeholder="Prefix (e.g. eth)"
					aria-label="Stub prefix"
					value={stubPrefix()}
					onInput={(e: InputEventAndTarget) => setStubPrefix(e.currentTarget.value)}
				/>
				<input
					placeholder="Count"
					aria-label="Stub count"
					inputmode="numeric"
					value={stubCount()}
					onInput={(e: InputEventAndTarget) => setStubCount(e.currentTarget.value)}
				/>
				<button type="submit">Add stub</button>{' '}
				<button type="button" onClick={handleAdhocPreview}>
					Preview {stubPrefix() || 'prefix'} × {stubCount() || '?'}
				</button>
			</form>
			<DataTable
				rows={() => stubs() ?? []}
				getRowId={(s: StubRow): number => s.id}
				columns={stubColumns}
				showColumnCustomizer
				rowActions={(s: StubRow): JSX.Element => (
					<button type="button" class="btn-danger" onClick={() => handleDeleteStub(s.id)}>
						Delete
					</button>
				)}
				loading={() => stubs.loading}
				loadingContent={<p class="skeleton">Loading stubs…</p>}
				emptyContent={<p class="empty">No stubs yet.</p>}
			/>
			<h3>Expansion preview ({previewNames().length} interfaces)</h3>
			<p>
				<code>{previewNames().join(', ') || '—'}</code>
			</p>

			<h3 id="device-type-devices">
				Devices <span class="badge">{deviceCount()}</span>
			</h3>
			<Show when={!devices.loading} fallback={<p class="skeleton">Loading devices…</p>}>
				<Show
					when={deviceCount() > 0}
					fallback={<p class="empty">No devices use this type yet.</p>}
				>
					<ul>
						<For each={devices() ?? []}>
							{(d: DeviceRow) => (
								<li>
									<a
										href={`/devices/${d.id}`}
										onClick={(e: MouseEvent): void => go(e, `/devices/${d.id}`)}
									>
										{d.name}
									</a>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</Show>
			<Show when={error()}>
				<div class="app-inline-error">{error()}</div>
			</Show>
		</div>
	)
}
