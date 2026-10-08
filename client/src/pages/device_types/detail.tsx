import type { Result } from 'better-result'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { type DeviceRow, fetch_devices } from '../../api/devices'
import {
	delete_device_type,
	delete_stub,
	fetch_device_type,
	fetch_manufacturer,
	fetch_stubs,
	type StubRow,
} from '../../api/templates'
import { DataTable, type DataTableColumn, descriptionColumn } from '../../components/data_table'
import {
	DetailCard,
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import { portKindLabel, yesNo } from '../../i18n/labels'
import { createRecord, createRowsFor, useAction } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { can } from '../../lib/session'
import { AddComponentDialog, AddComponentMenu } from './add_component'
import { COMPONENT_CLASSES, type ComponentClassInfo, componentClassOf } from './components'

/**
 * /device-types/:id — device-type detail: header with model, the "Add
 * components" menu and details grid (manufacturer, U height, description),
 * one table per component class, and the devices using this type.
 */
export function DeviceTypeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [adding, setAdding] = createSignal<ComponentClassInfo | null>(null)
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

	const action = useAction(setError)

	async function run(request: () => Promise<Result<unknown, Error>>): Promise<boolean> {
		const ok = await action.run(request)
		if (ok) {
			void refetchStubs()
		}
		return ok
	}

	const stubsOf = (info: ComponentClassInfo): StubRow[] =>
		(stubs() ?? []).filter((s) => componentClassOf(s.kind) === info.key)

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
			label: t('common.name'),
			getValue: (s: StubRow): JSX.Element => <code>{s.prefix}</code>,
		},
		{
			key: 'count',
			label: t('deviceType.component.count'),
			getValue: (s: StubRow): number => s.count,
		},
		{
			key: 'kind',
			label: t('common.type'),
			getValue: (s: StubRow): string => portKindLabel(s.kind),
		},
		{
			key: 'label',
			label: t('deviceType.component.label'),
			getValue: (s: StubRow): string => s.label ?? '—',
		},
		descriptionColumn<StubRow>(),
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
					actions={
						<Show when={can('edit')}>
							<AddComponentMenu onSelect={setAdding} />
						</Show>
					}
				/>
				<DetailSubtitle description={deviceType()?.description} />

				<DetailCard label={t('deviceType.details')}>
					<dt>{tp('entity.manufacturer', 1)}</dt>
					<dd>{manufacturer()?.name ?? manufacturerId() ?? '—'}</dd>
					<dt>{t('common.model')}</dt>
					<dd>{deviceType()?.model}</dd>
					<dt>{t('common.comments')}</dt>
					<dd>
						<Markdown text={deviceType()?.comments} />
					</dd>
					<dt>{t('common.heightU')}</dt>
					<dd>{deviceType()?.u_height}</dd>
					<dt>{t('common.fullDepth')}</dt>
					<dd>{yesNo(deviceType()?.is_full_depth ?? 0)}</dd>
				</DetailCard>
			</DetailShell>

			<Show
				when={!stubs.loading}
				fallback={<Loading message={t('deviceType.component.loading')} />}
			>
				<Show
					when={(stubs() ?? []).length > 0}
					fallback={
						<>
							<h3 id="device-type-components">{t('deviceType.component.heading')}</h3>
							<Empty message={t('deviceType.component.empty')} />
						</>
					}
				>
					<For each={COMPONENT_CLASSES.filter((info) => stubsOf(info).length > 0)}>
						{(info: ComponentClassInfo) => (
							<>
								<h3 id={`device-type-${info.key}s`}>
									{t(info.heading, { count: stubsOf(info).length })}
								</h3>
								<DataTable
									rows={() => stubsOf(info)}
									getRowId={(s: StubRow): number => s.id}
									columns={stubColumns}
									showColumnCustomizer
									rowActions={can('delete') ? stubActions : undefined}
								/>
							</>
						)}
					</For>
				</Show>
			</Show>
			<Show when={adding()}>
				{(info: () => ComponentClassInfo) => (
					<AddComponentDialog
						deviceTypeId={props.id}
						info={info()}
						onSaved={() => {
							setAdding(null)
							void refetchStubs()
						}}
						onClose={() => setAdding(null)}
					/>
				)}
			</Show>
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
