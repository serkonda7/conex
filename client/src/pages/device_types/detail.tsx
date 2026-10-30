import type { Result } from 'better-result'
import { websiteUrl } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { fetch_device_role } from '../../api/device_roles'
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
	ForeignKeyLink,
	RelatedSection,
	useDetailDelete,
} from '../../components/detail_page'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { Markdown } from '../../components/markdown'
import { t, tp } from '../../i18n'
import { deviceRoleLabel, portKindLabel, yesNo } from '../../i18n/labels'
import { createRecord, createRowsFor, useAction } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { can } from '../../lib/session'
import {
	AddComponentMenu,
	ComponentDialog,
	type PassThroughPreset,
	PassThroughPresetDialog,
} from './add_component'
import { COMPONENT_CLASSES, type ComponentClassInfo, componentClassOf } from './components'

/**
 * /device-types/:id — device-type detail: header with model, the "Add
 * components" menu and details grid (manufacturer, U height, description),
 * one table per component class, and the devices using this type.
 */
export function DeviceTypeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [adding, setAdding] = createSignal<ComponentClassInfo | null>(null)
	const [editing, setEditing] = createSignal<{
		info: ComponentClassInfo
		stub: StubRow
	} | null>(null)
	const [preset, setPreset] = createSignal<PassThroughPreset | null>(null)
	const id = (): number => props.id
	const [deviceType] = createRecord(id, fetch_device_type, setError)
	const manufacturerId = (): number | undefined => deviceType()?.manufacturer_id
	const [manufacturer] = createRecord(manufacturerId, fetch_manufacturer, setError)
	const defaultRoleId = (): number | undefined =>
		deviceType()?.default_device_role_id ?? undefined
	const [defaultRole] = createRecord(defaultRoleId, fetch_device_role, setError)
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
		(stubs() ?? []).filter((s) => componentClassOf(s) === info.key)
	const rearStubs = (): StubRow[] => (stubs() ?? []).filter((row) => row.side === 'rear')
	const stubPrefix = (stubId: number | null): string =>
		(stubs() ?? []).find((row) => row.id === stubId)?.prefix ?? '—'

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
	/** Patch-panel tables add the rear positions or the front-to-rear mapping. */
	const passThroughColumn: DataTableColumn<StubRow> = {
		key: 'pass_through',
		label: t('deviceType.component.mapping'),
		getValue: (s: StubRow): string =>
			s.side === 'rear'
				? tp('deviceType.component.positionsCount', s.positions)
				: t('deviceType.component.mapsTo', {
						rear: stubPrefix(s.rear_stub_id),
						position: s.rear_position,
					}),
	}
	const columnsOf = (info: ComponentClassInfo): DataTableColumn<StubRow>[] =>
		info.side
			? [...stubColumns.slice(0, 3), passThroughColumn, ...stubColumns.slice(3)]
			: stubColumns

	const stubActions = (info: ComponentClassInfo, s: StubRow): JSX.Element => (
		<div class="row-actions">
			<Show when={can('edit')}>
				<button type="button" onClick={(): void => void setEditing({ info, stub: s })}>
					{t('common.edit')}
				</button>
			</Show>
			<Show when={can('delete')}>
				<button
					type="button"
					class="btn-danger"
					onClick={(): void => void run(() => delete_stub(props.id, s.id))}
				>
					{t('common.delete')}
				</button>
			</Show>
		</div>
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
							<AddComponentMenu onSelect={setAdding} onPreset={setPreset} />
						</Show>
					}
				/>
				<DetailSubtitle description={deviceType()?.description} />

				<DetailCard label={t('deviceType.details')}>
					<dt>{tp('entity.manufacturer', 1)}</dt>
					<dd>{manufacturer()?.name ?? manufacturerId() ?? '—'}</dd>
					<dt>{t('common.model')}</dt>
					<dd>{deviceType()?.model}</dd>
					<dt>{t('deviceType.partNumber')}</dt>
					<dd>{deviceType()?.part_number || '—'}</dd>
					<dt>{t('deviceType.specUrl')}</dt>
					<dd>
						<Show when={deviceType()?.spec_url} fallback="—">
							{(url: () => string): JSX.Element => (
								<a
									href={websiteUrl(url())}
									target="_blank"
									rel="noopener noreferrer"
								>
									{url()}
								</a>
							)}
						</Show>
					</dd>
					<dt>{t('common.comments')}</dt>
					<dd>
						<Markdown text={deviceType()?.comments} />
					</dd>
					<dt>{t('common.heightU')}</dt>
					<dd>{deviceType()?.u_height}</dd>
					<dt>{t('common.fullDepth')}</dt>
					<dd>{yesNo(deviceType()?.is_full_depth ?? 0)}</dd>
					<dt>{t('deviceType.defaultRole')}</dt>
					<dd>
						<ForeignKeyLink
							id={defaultRoleId()}
							loading={defaultRole.loading}
							name={deviceRoleLabel(defaultRole())}
							href={`/device-roles/${defaultRoleId() ?? ''}`}
						/>
					</dd>
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
									columns={columnsOf(info)}
									showColumnCustomizer
									rowActions={
										can('edit') || can('delete')
											? (s: StubRow): JSX.Element => stubActions(info, s)
											: undefined
									}
								/>
							</>
						)}
					</For>
				</Show>
			</Show>
			<Show when={adding()}>
				{(info: () => ComponentClassInfo) => (
					<ComponentDialog
						deviceTypeId={props.id}
						info={info()}
						rearStubs={rearStubs()}
						onSaved={() => {
							setAdding(null)
							void refetchStubs()
						}}
						onClose={() => setAdding(null)}
					/>
				)}
			</Show>
			<Show when={editing()} keyed>
				{(target: { info: ComponentClassInfo; stub: StubRow }) => (
					<ComponentDialog
						deviceTypeId={props.id}
						info={target.info}
						stub={target.stub}
						rearStubs={rearStubs()}
						onSaved={() => {
							setEditing(null)
							void refetchStubs()
						}}
						onClose={() => setEditing(null)}
					/>
				)}
			</Show>
			<Show when={preset()}>
				{(key: () => PassThroughPreset) => (
					<PassThroughPresetDialog
						deviceTypeId={props.id}
						preset={key()}
						onSaved={() => {
							setPreset(null)
							void refetchStubs()
						}}
						onClose={() => setPreset(null)}
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
