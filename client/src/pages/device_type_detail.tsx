import { DataTable, type DataTableColumn } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, For } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../api_devices'
import {
	create_stub,
	delete_device_type,
	delete_stub,
	fetch_device_type,
	fetch_manufacturers,
	fetch_stubs,
	type StubRow,
} from '../api_templates'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	Empty,
	InlineError,
	Loading,
	RelatedSection,
	useDetailDelete,
} from '../components/detail_page'
import { go } from '../components/list_page'

/**
 * /device-types/:id — device-type detail: header with model and details
 * grid (manufacturer, U height, description), the interface-stub editor,
 * and the devices using this type.
 */
export function DeviceTypeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [stubPrefix, setStubPrefix] = createSignal('')
	const [stubCount, setStubCount] = createSignal('24')

	const [deviceType] = createResource(
		() => props.id,
		async (id: number) => {
			setError(null)
			const res = await fetch_device_type(id)
			if (Result.isError(res)) {
				setError(res.error.message)
				return null
			}
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
	}

	async function handleDeleteStub(stubId: number): Promise<void> {
		setError(null)
		const res = await delete_stub(props.id, stubId)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		void refetchStubs()
	}

	const { handleDelete } = useDetailDelete({
		noun: 'device type',
		name: () => deviceType()?.model,
		id: props.id,
		remove: delete_device_type,
		setError,
		listRoute: '/device-types',
	})

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
			<DetailShell
				backTo="/device-types"
				backLabel="Device types"
				loading={deviceType.loading}
				loadingText="Gerätetyp wird geladen…"
				record={deviceType()}
				emptyText="Device type not found."
			>
				<DetailHeader
					name={deviceType()?.model}
					editHref={`/device-types/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>{deviceType()?.description || 'No description.'}</DetailSubtitle>

				<DetailCard label="Gerätetypdetails">
					<dt>Hersteller</dt>
					<dd>{mfrNameOf(deviceType()?.manufacturer_id)}</dd>
					<dt>Modell</dt>
					<dd>{deviceType()?.model}</dd>
					<dt>Beschreibung</dt>
					<dd>{deviceType()?.description || '—'}</dd>
					<dt>Kommentare</dt>
					<dd>{deviceType()?.comments || '—'}</dd>
					<dt>Höhe (U)</dt>
					<dd>{deviceType()?.u_height}</dd>
					<dt>Volle Tiefe</dt>
					<dd>{deviceType()?.is_full_depth ? 'Yes' : 'No'}</dd>
				</DetailCard>
			</DetailShell>

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
				<button type="submit">Platzhalter hinzufügen</button>
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
				loadingContent={<Loading message="Platzhalter werden geladen…" />}
				emptyContent={<Empty message="Noch keine Platzhalter vorhanden." />}
			/>
			<RelatedSection
				id="device-type-devices"
				title="Devices"
				count={deviceCount()}
				loading={devices.loading}
				loadingText="Geräte werden geladen…"
				emptyText="Noch keine Geräte dieses Typs vorhanden."
				hasItems={deviceCount() > 0}
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
			</RelatedSection>
			<InlineError message={error()} />
		</div>
	)
}
