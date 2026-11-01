import { IconChevronDown, IconPencil, IconRefreshAlert, IconTrash } from '@tabler/icons-solidjs'
import type { Result } from 'better-result'
import { websiteUrl } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { fetch_device_role } from '../../api/device_roles'
import { type DeviceListDevice, fetch_all_devices_of_type } from '../../api/devices'
import { fetch_racks } from '../../api/racks'
import {
	delete_device_type,
	delete_stub,
	fetch_device_type,
	fetch_manufacturer,
	fetch_stubs,
	type StubRow,
} from '../../api/templates'
import { fetch_sites, fetch_tenants } from '../../api/tenancy'
import { type DataTableColumn, nameColumn } from '../../components/data_table'
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
import { Markdown } from '../../components/markdown'
import { ScrollLink } from '../../components/scroll_link'
import { t, tp } from '../../i18n'
import { deviceRoleLabel, portKindLabel, yesNo } from '../../i18n/labels'
import { portKindIcon } from '../../lib/icons'
import { useNameOf } from '../../lib/lookup'
import { createRecord, createRows, createRowsFor, useAction } from '../../lib/resource'
import type { Crumb } from '../../lib/router'
import { can } from '../../lib/session'
import { TemplateSyncDialog } from '../devices/template_sync_dialog'
import {
	AddComponentMenu,
	ComponentDialog,
	ItemIcon,
	type PassThroughPreset,
	PassThroughPresetDialog,
} from './add_component'
import {
	COMPONENT_CLASSES,
	type ComponentClassInfo,
	componentClassOf,
	stubRange,
} from './components'

/** Component groups with more rows than this start collapsed. */
const COMPONENT_GROUP_OPEN_ROWS = 16

/** Domain of a spec link; the full URL can overflow its narrow spec-sheet column. */
const specHost = (url: string): string => {
	const target = websiteUrl(url)
	return URL.canParse(target) ? new URL(target).hostname.replace(/^www\./, '') : url
}

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
					title={t('deviceType.component.editTitle', { name: props.stub.prefix })}
					aria-label={t('deviceType.component.editTitle', { name: props.stub.prefix })}
					onClick={(): void => props.onEdit()}
				>
					<IconPencil size={16} />
				</button>
			</Show>
			<Show when={can('delete')}>
				<button
					type="button"
					class="icon-btn"
					title={t('deviceType.component.deleteTitle', { name: props.stub.prefix })}
					aria-label={t('deviceType.component.deleteTitle', { name: props.stub.prefix })}
					onClick={(): void => props.onDelete()}
				>
					<IconTrash size={16} />
				</button>
			</Show>
		</span>
	)
}

/** Port kind with its glyph; the slot stays empty without one, so labels align. */
function ComponentKind(props: { kind: string }): JSX.Element {
	return (
		<span class="component-kind">
			<span class="component-kind-icon" aria-hidden="true">
				<Dynamic component={portKindIcon(props.kind)} size={18} />
			</span>
			{portKindLabel(props.kind)}
		</span>
	)
}

/** One stub; `mapping` is set on patch-panel types, `children` are its actions. */
function ComponentRow(props: {
	stub: StubRow
	mapping: string | undefined
	children: JSX.Element
}): JSX.Element {
	return (
		<tr>
			<td class="component-name">{stubRange(props.stub)}</td>
			<td class="component-count">{props.stub.count}</td>
			<td>
				<ComponentKind kind={props.stub.kind} />
			</td>
			<Show when={props.mapping !== undefined}>
				<td>{props.mapping}</td>
			</Show>
			<td>{props.stub.description || '—'}</td>
			<Show when={canChangeStubs()}>
				<td class="component-actions">{props.children}</td>
			</Show>
		</tr>
	)
}

/** Collapsible class of components; `children` are its rows. */
function ComponentGroup(props: {
	info: ComponentClassInfo
	stubs: StubRow[]
	columnCount: number
	open: boolean
	onToggle: () => void
	children: JSX.Element
}): JSX.Element {
	return (
		<tbody>
			<tr>
				<th scope="rowgroup" colSpan={props.columnCount} class="component-group">
					<button
						type="button"
						class="component-group-title"
						aria-expanded={props.open}
						onClick={(): void => props.onToggle()}
					>
						<IconChevronDown
							size={14}
							aria-hidden="true"
							class="component-group-chevron"
						/>
						<ItemIcon icon={props.info.icon} />
						{t(props.info.label)}{' '}
						<span class="text-muted">
							{props.stubs.reduce((sum, s) => sum + s.count, 0)}
						</span>
					</button>
				</th>
			</tr>
			<Show when={props.open}>{props.children}</Show>
		</tbody>
	)
}

/** Components of a device type, grouped by class. */
function ComponentTable(props: {
	stubs: StubRow[]
	stubsOf: (info: ComponentClassInfo) => StubRow[]
	isGroupOpen: (info: ComponentClassInfo) => boolean
	onToggleGroup: (info: ComponentClassInfo) => void
	onEdit: (info: ComponentClassInfo, stub: StubRow) => void
	onDelete: (stub: StubRow) => void
}): JSX.Element {
	const classes = (): readonly ComponentClassInfo[] =>
		COMPONENT_CLASSES.filter((info) => props.stubsOf(info).length > 0)
	/** Patch-panel types add a column with the rear positions or front-to-rear mapping. */
	const hasPassThrough = (): boolean => props.stubs.some((row) => row.side !== null)
	const columnCount = (): number => 4 + Number(hasPassThrough()) + Number(canChangeStubs())
	const stubPrefix = (stubId: number | null): string =>
		props.stubs.find((row) => row.id === stubId)?.prefix ?? '—'
	const passThrough = (s: StubRow): string => {
		if (!s.side) {
			return '—'
		}
		return s.side === 'rear'
			? tp('deviceType.component.positionsCount', s.positions)
			: t('deviceType.component.mapsTo', {
					rear: stubPrefix(s.rear_stub_id),
					position: s.rear_position,
				})
	}

	return (
		<div class="component-table-wrap">
			<table class="component-table">
				<thead>
					<tr>
						<th scope="col">{t('common.name')}</th>
						<th scope="col" class="component-count">
							{t('deviceType.component.count')}
						</th>
						<th scope="col">{t('common.type')}</th>
						<Show when={hasPassThrough()}>
							<th scope="col">{t('deviceType.component.mapping')}</th>
						</Show>
						<th scope="col">{t('common.description')}</th>
						<Show when={canChangeStubs()}>
							<th scope="col" />
						</Show>
					</tr>
				</thead>
				<For each={classes()}>
					{(info: ComponentClassInfo) => (
						<ComponentGroup
							info={info}
							stubs={props.stubsOf(info)}
							columnCount={columnCount()}
							open={props.isGroupOpen(info)}
							onToggle={(): void => props.onToggleGroup(info)}
						>
							<For each={props.stubsOf(info)}>
								{(s: StubRow) => (
									<ComponentRow
										stub={s}
										mapping={hasPassThrough() ? passThrough(s) : undefined}
									>
										<StubActions
											stub={s}
											onEdit={(): void => props.onEdit(info, s)}
											onDelete={(): void => props.onDelete(s)}
										/>
									</ComponentRow>
								)}
							</For>
						</ComponentGroup>
					)}
				</For>
			</table>
		</div>
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
	const id = (): number => props.id
	const [deviceType] = createRecord(id, fetch_device_type, setError)
	const manufacturerId = (): number | undefined => deviceType()?.manufacturer_id
	const [manufacturer] = createRecord(manufacturerId, fetch_manufacturer, setError)
	const defaultRoleId = (): number | undefined =>
		deviceType()?.default_device_role_id ?? undefined
	const [defaultRole] = createRecord(defaultRoleId, fetch_device_role, setError)
	const [stubs, { refetch: refetchStubs }] = createRowsFor(id, fetch_stubs, setError)
	const [devices, { refetch: refetchDevices }] = createRowsFor(
		id,
		fetch_all_devices_of_type,
		setError,
	)
	const deviceTotal = (): number => (devices() ?? []).length
	const [syncing, setSyncing] = createSignal<DeviceListDevice | null>(null)
	/** Component changes can put devices out of sync with the type. */
	const refreshComponents = (): void => {
		void refetchStubs()
		void refetchDevices()
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
		const ok = await action.run(request)
		if (ok) {
			refreshComponents()
		}
		return ok
	}

	const stubsOf = (info: ComponentClassInfo): StubRow[] =>
		(stubs() ?? []).filter((s) => componentClassOf(s) === info.key)
	/** Explicit open/closed choices; kept here since refetching unmounts the table. */
	const [groupToggles, setGroupToggles] = createSignal<Record<string, boolean>>({})
	const groupKey = (info: ComponentClassInfo): string => `${props.id}/${info.key}`
	const isGroupOpen = (info: ComponentClassInfo): boolean =>
		groupToggles()[groupKey(info)] ?? stubsOf(info).length <= COMPONENT_GROUP_OPEN_ROWS
	const toggleGroup = (info: ComponentClassInfo): void => {
		const open = isGroupOpen(info)
		setGroupToggles((toggles) => ({ ...toggles, [groupKey(info)]: !open }))
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
		{
			key: 'tenant',
			label: tp('entity.tenant', 1),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<Show when={d.tenant_id} fallback="—">
					{(tenant: () => number) => (
						<a href={`/tenants/${tenant()}`}>{tenantName(tenant())}</a>
					)}
				</Show>
			),
		},
		{
			key: 'site',
			label: t('tenant.siteRack'),
			getValue: (d: DeviceListDevice): JSX.Element => (
				<Show when={d.site_id !== null || d.rack_id !== null} fallback="—">
					<Show when={d.site_id}>
						{(site: () => number) => (
							<a href={`/sites/${site()}`}>{siteName(site())}</a>
						)}
					</Show>
					<Show when={d.site_id !== null && d.rack_id !== null}> / </Show>
					<Show when={d.rack_id}>
						{(rack: () => number) => (
							<a href={`/racks/${rack()}`}>
								{d.position_u === null
									? rackName(rack())
									: t('device.mountPosition', {
											rack: rackName(rack()),
											u: d.position_u,
										})}
							</a>
						)}
					</Show>
				</Show>
			),
		},
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
		if (window.confirm(t('deviceType.component.confirmDelete', { name: s.prefix }))) {
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
									{(url: () => string): JSX.Element => (
										<a
											href={websiteUrl(url())}
											target="_blank"
											rel="noopener noreferrer"
											title={url()}
										>
											{specHost(url())}
										</a>
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
							stubsOf={stubsOf}
							isGroupOpen={isGroupOpen}
							onToggleGroup={toggleGroup}
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
						onSaved={() => {
							setAdding(null)
							refreshComponents()
						}}
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
						onSaved={() => {
							setEditing(null)
							refreshComponents()
						}}
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
						onSaved={() => {
							setPreset(null)
							refreshComponents()
						}}
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
					noun="noun.device"
					emptyText={t('deviceType.noDevices')}
					columns={deviceColumns}
				/>
				<ViewAllLink
					href={`/devices?device_type=${props.id}&kind=device`}
					count={deviceTotal()}
					target={tp('entity.device', 2)}
				/>
			</section>
			<Show when={syncing()}>
				{(device: () => DeviceListDevice) => (
					<TemplateSyncDialog
						device={device()}
						on_synced={() => {
							setSyncing(null)
							void refetchDevices()
						}}
						on_close={() => setSyncing(null)}
					/>
				)}
			</Show>
			<InlineError message={error()} />
		</div>
	)
}
