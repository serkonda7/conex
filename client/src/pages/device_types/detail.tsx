import { Result } from 'better-result'
import type { InputEventAndTarget } from 'shared/src/types'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../../api/devices'
import {
	create_stub,
	delete_device_type,
	delete_stub,
	fetch_device_type,
	fetch_manufacturer,
	fetch_stubs,
	type StubRow,
} from '../../api/templates'
import { DataTable, type DataTableColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { t, tp } from '../../i18n'
import { createRecord, createRowsFor } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { can } from '../../lib/session'

const DEFAULT_STUB_COUNT = '24'

/**
 * /device-types/:id — device-type detail: header with model and details
 * grid (manufacturer, U height, description), the interface-stub editor,
 * and the devices using this type.
 */
export function DeviceTypeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [stubPrefix, setStubPrefix] = createSignal('')
	const [stubCount, setStubCount] = createSignal(DEFAULT_STUB_COUNT)
	const id = (): number => props.id
	const [deviceType] = createRecord(id, fetch_device_type, setError)
	const manufacturerId = (): number | undefined => deviceType()?.manufacturer_id
	const [manufacturer] = createRecord(manufacturerId, fetch_manufacturer, setError)
	const [stubs, { refetch: refetchStubs }] = createRowsFor(id, fetch_stubs, setError)
	// The device list has no type filter: narrow client-side.
	const [devices] = createRowsFor(id, () => fetch_devices(), setError)
	const ofType = (rows: DeviceRow[]): DeviceRow[] =>
		rows.filter((d) => d.device_type_id === props.id)

	const manufacturerCrumbs = (): Crumb[] => {
		const row = manufacturer()
		return row ? [{ label: row.name, href: `/manufacturers/${row.id}` }] : []
	}

	async function run(action: () => Promise<Result<unknown, Error>>): Promise<boolean> {
		setError(null)
		const res = await action()
		if (Result.isError(res)) {
			setError(res.error.message)
			return false
		}
		void refetchStubs()
		return true
	}

	async function handleCreateStub(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const count = Number(stubCount())
		if (!Number.isInteger(count) || count < 1) {
			setError(t('deviceType.stubCountInvalid'))
			return
		}
		if (await run(() => create_stub(props.id, { prefix: stubPrefix(), count }))) {
			setStubPrefix('')
			setStubCount(DEFAULT_STUB_COUNT)
		}
	}

	const handleDelete = useDetailDelete({
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

	const stubActions = (s: StubRow): JSX.Element => (
		<button
			type="button"
			class="btn-danger"
			onClick={(): void => void run(() => delete_stub(props.id, s.id))}
		>
			{t('common.delete')}
		</button>
	)

	return (
		<div>
			<DetailShell
				name={deviceType()?.model}
				crumbs={manufacturerCrumbs()}
				record={deviceType}
				loadingText={t('deviceType.loadingOne')}
				emptyText={t('deviceType.notFound')}
			>
				<DetailHeader
					name={deviceType()?.model}
					editHref={`/device-types/${props.id}/edit`}
					onDelete={handleDelete}
				/>
				<DetailSubtitle description={deviceType()?.description} />

				<DetailCard label={t('deviceType.details')}>
					<dt>{tp('entity.manufacturer', 1)}</dt>
					<dd>{manufacturer()?.name ?? manufacturerId() ?? '—'}</dd>
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

			<h3 id="device-type-stubs">{t('deviceType.stubs', { count: stubs()?.length ?? 0 })}</h3>
			<Show when={can('edit')}>
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
			</Show>
			<DataTable
				rows={() => stubs() ?? []}
				getRowId={(s: StubRow): number => s.id}
				columns={stubColumns}
				showColumnCustomizer
				rowActions={can('delete') ? stubActions : undefined}
				loading={() => stubs.loading}
				loadingContent={<Loading message={t('deviceType.loadingStubs')} />}
				emptyContent={<Empty message={t('deviceType.noStubs')} />}
			/>
			<RelatedSection
				id="device-type-devices"
				title={tp('entity.device', 2)}
				noun="noun.device"
				rows={devices}
				select={ofType}
				emptyText={t('deviceType.noDevices')}
			>
				<ul>
					<For each={ofType(devices() ?? [])}>
						{(d: DeviceRow) => (
							<li>
								<a href={`/devices/${d.id}`}>{d.name}</a>
							</li>
						)}
					</For>
				</ul>
			</RelatedSection>
			<InlineError message={error()} />
		</div>
	)
}
