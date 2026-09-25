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
import { DataTable, type DataTableColumn } from '../components/data_table'
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
import { t, tp } from '../i18n'
import { goTo } from '../router'

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
			setError(t('deviceType.stubCountInvalid'))
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
		noun: 'noun.deviceType',
		name: () => deviceType()?.model,
		id: props.id,
		remove: delete_device_type,
		setError,
		listRoute: '/device-types',
	})

	const stubColumns: DataTableColumn<StubRow>[] = [
		{
			key: 'prefix',
			label: t('deviceType.stubPrefix'),
			getValue: (s: StubRow): JSX.Element => <code>{s.prefix}</code>,
		},
		{
			key: 'count',
			label: t('deviceType.stubCount'),
			getValue: (s: StubRow): number => s.count,
		},
		{ key: 'kind', label: t('deviceType.stubKind'), getValue: (s: StubRow): string => s.kind },
	]

	const stubCountText = (): number => stubs()?.length ?? 0
	const deviceCount = (): number => devices()?.length ?? 0

	return (
		<div>
			<DetailShell
				backTo="/device-types"
				backLabel={tp('entity.deviceType', 2)}
				loading={deviceType.loading}
				loadingText={t('deviceType.loadingOne')}
				record={deviceType()}
				emptyText={t('deviceType.notFound')}
			>
				<DetailHeader
					name={deviceType()?.model}
					editHref={`/device-types/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle>
					{deviceType()?.description || t('common.noDescription')}
				</DetailSubtitle>

				<DetailCard label={t('deviceType.details')}>
					<dt>{tp('entity.manufacturer', 1)}</dt>
					<dd>{mfrNameOf(deviceType()?.manufacturer_id)}</dd>
					<dt>{t('common.model')}</dt>
					<dd>{deviceType()?.model}</dd>
					<dt>{t('common.description')}</dt>
					<dd>{deviceType()?.description || '—'}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>{deviceType()?.comments || '—'}</dd>
					<dt>{t('common.heightU')}</dt>
					<dd>{deviceType()?.u_height}</dd>
					<dt>{t('common.fullDepth')}</dt>
					<dd>{deviceType()?.is_full_depth ? t('common.yes') : t('common.no')}</dd>
				</DetailCard>
			</DetailShell>

			<h3 id="device-type-stubs">{t('deviceType.stubs', { count: stubCountText() })}</h3>
			<form onSubmit={handleCreateStub}>
				<input
					placeholder={t('deviceType.stubPrefixPlaceholder')}
					aria-label={t('deviceType.stubPrefixLabel')}
					value={stubPrefix()}
					onInput={(e: InputEventAndTarget) => setStubPrefix(e.currentTarget.value)}
				/>
				<input
					placeholder={t('deviceType.stubCount')}
					aria-label={t('deviceType.stubCountLabel')}
					inputmode="numeric"
					value={stubCount()}
					onInput={(e: InputEventAndTarget) => setStubCount(e.currentTarget.value)}
				/>
				<button type="submit">{t('deviceType.addStub')}</button>
			</form>
			<DataTable
				rows={() => stubs() ?? []}
				getRowId={(s: StubRow): number => s.id}
				columns={stubColumns}
				showColumnCustomizer
				rowActions={(s: StubRow): JSX.Element => (
					<button type="button" class="btn-danger" onClick={() => handleDeleteStub(s.id)}>
						{t('common.delete')}
					</button>
				)}
				loading={() => stubs.loading}
				loadingContent={<Loading message={t('deviceType.loadingStubs')} />}
				emptyContent={<Empty message={t('deviceType.noStubs')} />}
			/>
			<RelatedSection
				id="device-type-devices"
				title={tp('entity.device', 2)}
				count={deviceCount()}
				loading={devices.loading}
				loadingText={t('list.loading', { noun: tp('noun.device', 2) })}
				emptyText={t('deviceType.noDevices')}
				hasItems={deviceCount() > 0}
			>
				<ul>
					<For each={devices() ?? []}>
						{(d: DeviceRow) => (
							<li>
								<a
									href={`/devices/${d.id}`}
									onClick={(e: MouseEvent): void => goTo(e, `/devices/${d.id}`)}
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
