import {
	IconBolt,
	IconCheck,
	IconFileExport,
	IconPencil,
	IconPlug,
	IconRefreshAlert,
	IconSparkles,
	IconTrash,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { fetch_device_role } from '../../api/device_roles'
import { type DeviceListDevice, fetch_all_devices_of_type } from '../../api/devices'
import { fetch_racks } from '../../api/racks'
import {
	delete_device_type,
	delete_stub,
	fetch_device_type,
	fetch_device_type_yaml,
	fetch_manufacturer,
	fetch_stubs,
	type StubRow,
} from '../../api/templates'
import { fetch_sites, fetch_tenants } from '../../api/tenancy'
import { DataTable, type DataTableColumn, nameColumn } from '../../components/data_table'
import {
	DetailHeader,
	DetailShell,
	DetailSubtitle,
	ForeignKeyLink,
	RelatedPreview,
	useDetailDelete,
	ViewAllLink,
} from '../../components/detail_page'
import { Empty, InlineError, Loading } from '../../components/feedback'
import { IconLabel } from '../../components/icon_label'
import { Markdown } from '../../components/markdown'
import { ScrollLink } from '../../components/scroll_link'
import { t, tp } from '../../i18n'
import {
	deviceRoleLabel,
	poeModeLabel,
	poeTypeLabel,
	poeTypeShortLabel,
	yesNo,
} from '../../i18n/labels'
import { useNameOf } from '../../lib/lookup'
import { createRecord, createRows, createRowsFor, useAction } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { can } from '../../lib/session'
import { formatDate, isPastEol } from '../../lib/time'
import { devicePlacementColumns } from '../devices/placement_columns'
import { TemplateSyncDialog } from '../devices/template_sync_dialog'
import {
	AddComponentMenu,
	ComponentDialog,
	type PassThroughPreset,
	PassThroughPresetDialog,
} from './add_component'
import { AiUpdateDialog } from './ai_update_dialog'
import { ComponentKind, componentGroups } from './component_table'
import {
	COMPONENT_CLASSES,
	type ComponentClassInfo,
	componentClassOf,
	stubLabel,
	stubRange,
} from './components'
import { EolPill } from './eol_pill'
import { SpecLink } from './spec_link'

/** How long the export button confirms the copy. */
const EXPORTED_MS = 1500

const canChangeStubs = (): boolean => can('edit') || can('delete')

/** Edit and delete buttons of a stub, as far as the user may use them. */
function StubActions(props: {
	stub: StubRow
	onEdit: () => void
	onDelete: () => void
}): JSX.Element {
	return (
		<span class="row-actions">
			<Show when={can('edit')}>
				<button
					type="button"
					class="icon-btn"
					title={t('deviceType.component.editTitle', { name: stubLabel(props.stub) })}
					aria-label={t('deviceType.component.editTitle', {
						name: stubLabel(props.stub),
					})}
					onClick={(): void => props.onEdit()}
				>
					<IconPencil size={16} />
				</button>
			</Show>
			<Show when={can('delete')}>
				<button
					type="button"
					class="icon-btn"
					title={t('deviceType.component.deleteTitle', { name: stubLabel(props.stub) })}
					aria-label={t('deviceType.component.deleteTitle', {
						name: stubLabel(props.stub),
					})}
					onClick={(): void => props.onDelete()}
				>
					<IconTrash size={16} />
				</button>
			</Show>
		</span>
	)
}

const hasPowerDetails = (stub: StubRow): boolean =>
	stub.maximum_draw !== null || stub.poe_mode !== null

/**
 * Maximum draw of a power input or PoE setup of an interface. PoE reads as an
 * icon per direction (bolt: supplies, plug: draws) and the short type; the
 * tooltip spells out both.
 */
function PowerDetails(props: { stub: StubRow }): JSX.Element {
	const poeTitle = (mode: string): string => {
		const type = props.stub.poe_type
		return type === null ? poeModeLabel(mode) : `${poeModeLabel(mode)} · ${poeTypeLabel(type)}`
	}
	return (
		<Show
			when={props.stub.poe_mode}
			fallback={
				props.stub.maximum_draw === null
					? '—'
					: t('deviceType.component.watts', { watts: props.stub.maximum_draw })
			}
		>
			{(mode: () => string): JSX.Element => (
				<span class="component-kind" title={poeTitle(mode())}>
					<Dynamic
						component={mode() === 'pse' ? IconBolt : IconPlug}
						size={16}
						role="img"
						aria-label={poeModeLabel(mode())}
					/>
					{props.stub.poe_type === null
						? t('deviceType.component.poe')
						: poeTypeShortLabel(props.stub.poe_type)}
				</span>
			)}
		</Show>
	)
}

/** Components of a device type, grouped by class. */
function ComponentTable(props: {
	stubs: StubRow[]
	onEdit: (info: ComponentClassInfo, stub: StubRow) => void
	onDelete: (stub: StubRow) => void
}): JSX.Element {
	/** Patch-panel types add a column with the rear positions or front-to-rear mapping. */
	const hasPassThrough = (): boolean => props.stubs.some((row) => row.side !== null)
	/** Types with a maximum draw or PoE add a column for them. */
	const hasPower = (): boolean => props.stubs.some(hasPowerDetails)
	const rearName = (stubId: number | null): string => {
		const rear = props.stubs.find((row) => row.id === stubId)
		return rear ? stubLabel(rear) : '—'
	}
	const passThrough = (s: StubRow): string => {
		if (!s.side) {
			return '—'
		}
		return s.side === 'rear'
			? tp('deviceType.component.positionsCount', s.positions)
			: t('deviceType.component.mapsTo', {
					rear: rearName(s.rear_stub_id),
					position: s.rear_position,
				})
	}
	const infoOf = (s: StubRow): ComponentClassInfo =>
		COMPONENT_CLASSES.find((info) => info.key === componentClassOf(s)) ?? COMPONENT_CLASSES[0]

	const columns = createMemo((): DataTableColumn<StubRow>[] => [
		{
			key: 'name',
			label: t('common.name'),
			class: 'component-name',
			getValue: (s: StubRow): string => stubRange(s),
		},
		{
			key: 'count',
			label: t('deviceType.component.count'),
			class: 'component-count',
			getValue: (s: StubRow): number => s.count,
		},
		{
			key: 'kind',
			label: t('common.type'),
			getValue: (s: StubRow): JSX.Element => <ComponentKind kind={s.kind} />,
		},
		...(hasPassThrough()
			? [
					{
						key: 'mapping',
						label: t('deviceType.component.mapping'),
						getValue: passThrough,
					},
				]
			: []),
		...(hasPower()
			? [
					{
						key: 'power',
						label: t('deviceType.component.power'),
						getValue: (s: StubRow): JSX.Element => <PowerDetails stub={s} />,
					},
				]
			: []),
	])

	return (
		<DataTable
			class="component-table"
			columnLines
			rows={() => props.stubs}
			getRowId={(s: StubRow): number => s.id}
			columns={columns()}
			{...componentGroups<StubRow>((rows) => rows.reduce((sum, s) => sum + s.count, 0))}
			rowActions={
				canChangeStubs()
					? (s: StubRow): JSX.Element => (
							<StubActions
								stub={s}
								onEdit={(): void => props.onEdit(infoOf(s), s)}
								onDelete={(): void => props.onDelete(s)}
							/>
						)
					: undefined
			}
		/>
	)
}

/**
 * /device-types/:id — device-type detail: header with model, spec sheet
 * (hardware, physical, usage, comments), the components grouped by class with
 * the "Add components" menu, and the devices using this type.
 */
export function DeviceTypeDetailPage(props: { id: number }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [adding, setAdding] = createSignal<ComponentClassInfo | null>(null)
	const [editing, setEditing] = createSignal<{
		info: ComponentClassInfo
		stub: StubRow
	} | null>(null)
	const [preset, setPreset] = createSignal<PassThroughPreset | null>(null)
	const [updatingWithAi, setUpdatingWithAi] = createSignal(false)
	const id = (): number => props.id
	const [deviceType] = createRecord(id, fetch_device_type, setError)
	const manufacturerId = (): number | undefined => deviceType()?.manufacturer_id
	const [manufacturer] = createRecord(manufacturerId, fetch_manufacturer, setError)
	const defaultRoleId = (): number | undefined =>
		deviceType()?.default_device_role_id ?? undefined
	const [defaultRole] = createRecord(defaultRoleId, fetch_device_role, setError)
	const [stubs] = createRowsFor(id, fetch_stubs, setError)
	const [devices] = createRowsFor(id, fetch_all_devices_of_type, setError)
	const deviceTotal = (): number => (devices() ?? []).length
	const [syncing, setSyncing] = createSignal<DeviceListDevice | null>(null)
	/** The next differing device in list order, wrapping past the end. */
	const nextOutOfSync = (current: DeviceListDevice): DeviceListDevice | null => {
		const rows = devices() ?? []
		const at = rows.findIndex((row) => row.id === current.id)
		const others = [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0))]
		return others.find((row) => row.out_of_sync) ?? null
	}
	const [tenants] = createRows(fetch_tenants, setError)
	const [sites] = createRows(fetch_sites, setError)
	const [racks] = createRows(fetch_racks, setError)
	const tenantName = useNameOf(tenants)
	const siteName = useNameOf(sites)
	const rackName = useNameOf(racks)

	const manufacturerCrumbs = (): Crumb[] => {
		const row = manufacturer()
		return row ? [{ label: row.name, href: `/manufacturers/${row.id}` }] : []
	}

	const action = useAction(setError)

	async function run(request: () => Promise<Result<unknown, Error>>): Promise<boolean> {
		return action.run(request)
	}

	/** Briefly true after the YAML export reached the clipboard. */
	const [exported, setExported] = createSignal(false)
	let exportedTimer: ReturnType<typeof setTimeout> | undefined
	onCleanup(() => clearTimeout(exportedTimer))

	async function exportYaml(): Promise<void> {
		setExported(false)
		const copied = await run(async () => {
			const res = await fetch_device_type_yaml(props.id)
			if (Result.isError(res)) {
				return res
			}
			return Result.tryPromise({
				try: () => navigator.clipboard.writeText(res.value.yaml),
				catch: () => new Error(t('deviceType.exportYaml.failed')),
			})
		})
		if (copied) {
			setExported(true)
			clearTimeout(exportedTimer)
			exportedTimer = setTimeout(() => setExported(false), EXPORTED_MS)
		}
	}

	const rearStubs = (): StubRow[] => (stubs() ?? []).filter((row) => row.side === 'rear')

	const handleDelete = useDetailDelete({
		noun: 'noun.deviceType',
		name: () => deviceType()?.model,
		id: props.id,
		remove: delete_device_type,
		setError,
		listRoute: '/device-types',
	})

	const deviceColumns: DataTableColumn<DeviceListDevice>[] = [
		nameColumn<DeviceListDevice>(t('common.name'), '/devices'),
		...devicePlacementColumns({ tenantName, siteName, rackName }),
		{
			key: 'template_sync',
			label: t('device.templateSync.column'),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<Show when={d.out_of_sync && can('edit')}>
					<button
						type="button"
						class="icon-btn"
						title={t('device.templateSync.button')}
						aria-label={t('device.templateSync.button')}
						onClick={(): void => {
							setSyncing(d)
						}}
					>
						<IconRefreshAlert size={18} />
					</button>
				</Show>
			),
		},
	]

	async function deleteStub(s: StubRow): Promise<void> {
		if (window.confirm(t('deviceType.component.confirmDelete', { name: stubLabel(s) }))) {
			await run(() => delete_stub(props.id, s.id))
		}
	}

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
						<>
							<button
								type="button"
								title={t('deviceType.exportYaml.hint')}
								onClick={() => void exportYaml()}
							>
								<IconLabel icon={exported() ? IconCheck : IconFileExport}>
									{exported()
										? t('deviceType.exportYaml.copied')
										: t('deviceType.exportYaml.button')}
								</IconLabel>
							</button>
							<Show when={can('edit')}>
								<button type="button" onClick={() => setUpdatingWithAi(true)}>
									<IconLabel icon={IconSparkles}>
										{t('deviceType.aiUpdate.button')}
									</IconLabel>
								</button>
							</Show>
						</>
					}
				/>
				<DetailSubtitle description={deviceType()?.description} />

				<section class="spec-sheet" aria-label={t('deviceType.details')}>
					<section>
						<h4>{t('deviceType.section.hardware')}</h4>
						<dl>
							<dt>{tp('entity.manufacturer', 1)}</dt>
							<dd>
								<ForeignKeyLink
									id={manufacturerId()}
									loading={manufacturer.loading}
									name={manufacturer()?.name}
									href={`/manufacturers/${manufacturerId() ?? ''}`}
								/>
							</dd>
							<dt>{t('deviceType.partNumber')}</dt>
							<dd>{deviceType()?.part_number || '—'}</dd>
							<dt>{t('deviceType.specUrl')}</dt>
							<dd>
								<Show when={deviceType()?.spec_url} fallback="—">
									{(url: () => string): JSX.Element => <SpecLink url={url()} />}
								</Show>
							</dd>
							<dt>{t('deviceType.eolDate')}</dt>
							<dd>
								<Show when={deviceType()?.eol_date} fallback="—">
									{(date: () => string): JSX.Element => (
										<Show
											when={isPastEol(date())}
											fallback={formatDate(date())}
										>
											<EolPill date={date()} />
										</Show>
									)}
								</Show>
							</dd>
						</dl>
					</section>
					<section>
						<h4>{t('deviceType.section.physical')}</h4>
						<dl>
							<dt>{t('common.heightU')}</dt>
							<dd>{deviceType()?.u_height}</dd>
							<dt>{t('common.fullDepth')}</dt>
							<dd>{yesNo(deviceType()?.is_full_depth ?? 0)}</dd>
						</dl>
					</section>
					<section>
						<h4>{t('deviceType.section.usage')}</h4>
						<dl>
							<dt>{t('deviceType.defaultRole')}</dt>
							<dd>
								<ForeignKeyLink
									id={defaultRoleId()}
									loading={defaultRole.loading}
									name={deviceRoleLabel(defaultRole())}
									href={`/device-roles/${defaultRoleId() ?? ''}`}
								/>
							</dd>
							<dt>{tp('entity.device', 2)}</dt>
							<dd>
								<ScrollLink target="device-type-devices">
									{deviceTotal()}
								</ScrollLink>
							</dd>
						</dl>
					</section>
					<Show when={deviceType()?.comments}>
						<section class="spec-sheet-notes">
							<h4>{t('common.comments')}</h4>
							<Markdown text={deviceType()?.comments} />
						</section>
					</Show>
				</section>
			</DetailShell>

			<section class="component-section" id="device-type-components">
				<div class="card-header">
					<h3>
						{t('deviceType.component.heading')}{' '}
						<span class="badge">{(stubs() ?? []).length}</span>
					</h3>
					<Show when={can('edit')}>
						<AddComponentMenu onSelect={setAdding} onPreset={setPreset} />
					</Show>
				</div>
				<Show
					when={!stubs.loading}
					fallback={<Loading message={t('deviceType.component.loading')} />}
				>
					<Show
						when={(stubs() ?? []).length > 0}
						fallback={<Empty message={t('deviceType.component.empty')} />}
					>
						<ComponentTable
							stubs={stubs() ?? []}
							onEdit={(info: ComponentClassInfo, stub: StubRow): void =>
								void setEditing({ info, stub })
							}
							onDelete={(stub: StubRow): void => void deleteStub(stub)}
						/>
					</Show>
				</Show>
			</section>
			<Show when={adding()}>
				{(info: () => ComponentClassInfo) => (
					<ComponentDialog
						deviceTypeId={props.id}
						existingDevices={deviceTotal()}
						info={info()}
						rearStubs={rearStubs()}
						onSaved={() => setAdding(null)}
						onClose={() => setAdding(null)}
					/>
				)}
			</Show>
			<Show when={editing()} keyed>
				{(target: { info: ComponentClassInfo; stub: StubRow }) => (
					<ComponentDialog
						deviceTypeId={props.id}
						existingDevices={deviceTotal()}
						info={target.info}
						stub={target.stub}
						rearStubs={rearStubs()}
						onSaved={() => setEditing(null)}
						onClose={() => setEditing(null)}
					/>
				)}
			</Show>
			<Show when={preset()}>
				{(key: () => PassThroughPreset) => (
					<PassThroughPresetDialog
						deviceTypeId={props.id}
						existingDevices={deviceTotal()}
						preset={key()}
						onSaved={() => setPreset(null)}
						onClose={() => setPreset(null)}
					/>
				)}
			</Show>
			<section class="component-section device-preview" id="device-type-devices">
				<div class="card-header">
					<h3>
						{tp('entity.device', 2)} <span class="badge">{deviceTotal()}</span>
					</h3>
				</div>
				<RelatedPreview
					rows={devices() ?? []}
					loading={devices() === undefined}
					all
					columnLines
					noun="noun.device"
					emptyText={t('deviceType.noDevices')}
					columns={deviceColumns}
				/>
				<ViewAllLink
					href={`/devices?device_type=${props.id}&kind=device`}
					target={tp('entity.device', 2)}
				/>
			</section>
			<Show when={updatingWithAi()}>
				<AiUpdateDialog
					device_type_id={props.id}
					model={deviceType()?.model ?? ''}
					on_applied={() => setUpdatingWithAi(false)}
					on_close={() => setUpdatingWithAi(false)}
				/>
			</Show>
			<Show when={syncing()} keyed>
				{(device: DeviceListDevice) => (
					<TemplateSyncDialog
						device={device}
						has_next={nextOutOfSync(device) !== null}
						on_synced={(next: boolean) => {
							setSyncing(next ? nextOutOfSync(device) : null)
						}}
						on_close={() => setSyncing(null)}
					/>
				)}
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
