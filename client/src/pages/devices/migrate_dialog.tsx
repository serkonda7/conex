import { IconReplace } from '@tabler/icons-solidjs'
import { portKindsCompatible } from 'shared/src/ports'
import type { DeviceStatus, TraceLink } from 'shared/src/types'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import {
	type DeviceDetail,
	type DeviceRow,
	fetch_device,
	fetch_interfaces,
	type InterfaceJson,
	migrate_device,
} from '../../api/devices'
import { InlineError, Loading } from '../../components/feedback'
import { CheckboxField, type FormOption, Hint, SelectField } from '../../components/form'
import type { RowMenuAction } from '../../components/list_page'
import { Modal } from '../../components/modal'
import { ObjectSearch } from '../../components/object_selector'
import { t, tp } from '../../i18n'
import { deviceStatusLabel } from '../../i18n/labels'
import { createRecord, createRowsFor, useAction } from '../../lib/resource'
import { navigate } from '../../lib/router'
import { useDeviceSearch } from './device_search'
import { DeviceStatusBadge } from './status'
import { portLabel } from './template_sync_dialog'

/** Statuses the old device can take on, retired first. */
const STATUSES: readonly DeviceStatus[] = [
	'decommissioned',
	'inactive',
	'staged',
	'planned',
	'active',
]

/** Detail page ⋯ menu item that opens the {@link MigrateDeviceDialog}. */
export function migrateDeviceAction(onSelect: () => void): RowMenuAction {
	return { label: t('device.migrate.button'), icon: IconReplace, onSelect }
}

export interface MigrateDeviceDialogProps {
	device: DeviceDetail
	/** The device's ports and their cables (by local port id). */
	ports: readonly InterfaceJson[]
	links: ReadonlyMap<number, TraceLink>
	/** Virtual machines the device hosts. */
	vm_count: number
	on_close: () => void
}

/** A port of the old device with its cable. */
interface CabledPort {
	port: InterfaceJson
	link: TraceLink
}

/** A free port of the new device the cable to `link`'s far end fits on. */
function fits(port: InterfaceJson, link: TraceLink): boolean {
	return (
		port.patched && !port.connected && portKindsCompatible(port.kind, link.peer_interface.kind)
	)
}

/** Last number in a port name: `Gi1/0/5` -> 5, `Port 07` -> 7, `mgmt` -> null. */
function portNumber(name: string): number | null {
	const match = /(\d+)\D*$/.exec(name)
	return match ? Number(match[1]) : null
}

/**
 * Migrates a device to its replacement (a new switch, PC, …): pick the new
 * device, then which cables move to which of its ports (by default the
 * port with the same name, else with the same kind and number), and
 * whether placement, tenant and employees, VMs and the name go along. The
 * old device takes on a new status, decommissioned by default. The server
 * re-validates everything in one transaction.
 */
export function MigrateDeviceDialog(props: MigrateDeviceDialogProps): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [targetId, setTargetId] = createSignal<number | null>(null)
	const [target] = createRecord(targetId, fetch_device, setError)
	const [targetPorts] = createRowsFor(targetId, fetch_interfaces, setError)
	/** Chosen new port per old port id; missing entries take the default. */
	const [choices, setChoices] = createSignal<Record<number, string>>({})
	const [placement, setPlacement] = createSignal(true)
	const [assignment, setAssignment] = createSignal(true)
	const [vms, setVms] = createSignal(true)
	const [name, setName] = createSignal(true)
	const [status, setStatus] = createSignal<string>('decommissioned')
	const save = useAction(setError)
	const search = useDeviceSearch((device: DeviceRow) => deviceStatusLabel(device.status))

	const cabled = createMemo((): CabledPort[] =>
		props.ports.flatMap((port) => {
			const link = props.links.get(port.id)
			return link ? [{ port, link }] : []
		}),
	)
	/**
	 * Default new port per old port id: the port with the same side and name,
	 * else one with the same side, kind and number, if the cable fits it.
	 * Each new port takes at most one cable.
	 */
	const defaults = createMemo((): Map<number, string> => {
		const free = (targetPorts() ?? []).filter((other) => other.patched && !other.connected)
		const used = new Set<number>()
		const result = new Map<number, string>()
		const assign = (same: (port: InterfaceJson, other: InterfaceJson) => boolean): void => {
			for (const { port, link } of cabled()) {
				if (result.has(port.id)) {
					continue
				}
				const match = free.find(
					(other) =>
						!used.has(other.id) &&
						other.side === port.side &&
						same(port, other) &&
						fits(other, link),
				)
				if (match) {
					used.add(match.id)
					result.set(port.id, String(match.id))
				}
			}
		}
		assign((port, other) => other.name === port.name)
		assign((port, other) => {
			const number = portNumber(port.name)
			return number !== null && other.kind === port.kind && portNumber(other.name) === number
		})
		return result
	})
	const choiceOf = (port: InterfaceJson): string =>
		choices()[port.id] ?? defaults().get(port.id) ?? ''
	/** New port id → old port id it takes the cable of. */
	const taken = createMemo(
		() =>
			new Map(
				cabled().flatMap(({ port }) => {
					const choice = choiceOf(port)
					return choice === '' ? [] : [[choice, port.id] as const]
				}),
			),
	)
	const optionsOf = (port: InterfaceJson, link: TraceLink): FormOption[] =>
		(targetPorts() ?? [])
			.filter((other) => {
				const owner = taken().get(String(other.id))
				return fits(other, link) && (owner === undefined || owner === port.id)
			})
			.map((other) => ({ value: other.id, label: portLabel(other) }))
	const moved = (): number => taken().size

	const source = (): DeviceDetail => props.device
	const otherTenant = (): boolean => {
		const row = target()
		return row !== null && row !== undefined && row.tenant_id !== source().tenant_id
	}
	const hasPlacement = (): boolean =>
		source().site_id !== null || source().location_id !== null || source().rack_id !== null
	const hasAssignment = (): boolean => otherTenant() || source().employee_ids.length > 0
	const renames = (): boolean => {
		const row = target()
		return row !== null && row !== undefined && row.name !== source().name
	}
	/** A tenant change is the only way the devices end up in one tenant. */
	const takesAssignment = (): boolean => otherTenant() || (hasAssignment() && assignment())

	const placementHint = (): string =>
		[
			source().site_name,
			source().location_name,
			source().rack_name &&
				(source().position_u === null
					? source().rack_name
					: `${source().rack_name} ${t('common.unitPosition', { u: source().position_u ?? '' })}`),
		]
			.filter(Boolean)
			.join(' · ')

	const assignmentLabel = (): string => {
		const tenant = source().tenant_name ?? t('device.migrate.noTenant')
		const count = source().employee_ids.length
		return count === 0
			? t('device.migrate.tenant', { tenant })
			: t('device.migrate.assignment', {
					tenant,
					employees: tp('device.migrate.employees', count),
				})
	}

	async function handleMigrate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const row = target()
		if (!row) {
			return
		}
		const input = {
			target_id: row.id,
			ports: [...taken()].map(([to, from]) => ({ from, to: Number(to) })),
			placement: hasPlacement() && placement(),
			assignment: takesAssignment(),
			vms: props.vm_count > 0 && vms(),
			name: renames() && name(),
			status: status() === '' ? undefined : (status() as DeviceStatus),
		}
		if (await save.run(() => migrate_device(source().id, input))) {
			props.on_close()
			navigate(`/devices/${row.id}`)
		}
	}

	return (
		<Modal
			title={t('device.migrate.title', { name: source().name })}
			class="migrate-dialog"
			on_close={props.on_close}
		>
			<Show
				when={targetId() !== null}
				fallback={
					<>
						<p>{t('device.migrate.pick')}</p>
						<ObjectSearch
							{...search}
							load={async (value: string) => {
								const res = await search.load(value)
								return res.map((rows) => rows.filter((d) => d.id !== source().id))
							}}
							on_select={(device: DeviceRow): void => {
								setError(null)
								setChoices({})
								setTargetId(device.id)
							}}
						/>
					</>
				}
			>
				<Show
					when={target() && targetPorts()}
					fallback={<Loading message={t('device.loadingOne')} />}
				>
					<form class="form-stacked" onSubmit={handleMigrate}>
						<div class="migrate-target">
							<span>
								{t('device.migrate.target')}{' '}
								<a
									href={`/devices/${target()?.id ?? ''}`}
									target="_blank"
									rel="noopener"
								>
									{target()?.name}
								</a>{' '}
								<span class="text-muted">{target()?.device_type_model}</span>{' '}
								<DeviceStatusBadge status={target()?.status ?? 'active'} />
							</span>
							<button
								type="button"
								class="btn-outline"
								onClick={() => setTargetId(null)}
								disabled={save.pending()}
							>
								{t('device.migrate.change')}
							</button>
						</div>

						<h3>{t('device.migrate.cables', { count: cabled().length })}</h3>
						<Show
							when={cabled().length > 0}
							fallback={<Hint>{t('device.migrate.noCables')}</Hint>}
						>
							<For each={cabled()}>
								{({ port, link }: CabledPort): JSX.Element => (
									<SelectField
										id={`migrate-port-${port.id}`}
										label={t('device.migrate.cable', {
											port: portLabel(port),
											peer: `${link.peer_device.name} ${link.peer_interface.name}`,
										})}
										value={choiceOf(port)}
										onChange={(value: string): void => {
											setChoices((all) => ({ ...all, [port.id]: value }))
										}}
										options={optionsOf(port, link)}
										emptyLabel={t('device.migrate.keepCable')}
									/>
								)}
							</For>
							<Hint>
								{t('device.migrate.cablesMoved', {
									moved: moved(),
									count: cabled().length,
								})}
							</Hint>
						</Show>

						<h3>{t('device.migrate.takeOver')}</h3>
						<Show when={hasPlacement()}>
							<CheckboxField
								id="migrate-placement"
								label={t('device.migrate.placement', { where: placementHint() })}
								checked={placement()}
								onChange={setPlacement}
							/>
						</Show>
						<Show when={hasAssignment()}>
							<CheckboxField
								id="migrate-assignment"
								label={assignmentLabel()}
								checked={takesAssignment()}
								onChange={setAssignment}
								disabled={otherTenant()}
								title={otherTenant() ? t('device.migrate.otherTenant') : undefined}
							/>
						</Show>
						<Show when={props.vm_count > 0}>
							<CheckboxField
								id="migrate-vms"
								label={tp('device.migrate.vms', props.vm_count)}
								checked={vms()}
								onChange={setVms}
							/>
						</Show>
						<Show when={renames()}>
							<CheckboxField
								id="migrate-name"
								label={t('device.migrate.name', { name: source().name })}
								checked={name()}
								onChange={setName}
							/>
						</Show>
						<Show when={otherTenant()}>
							<Hint>{t('device.migrate.otherTenant')}</Hint>
						</Show>

						<SelectField
							id="migrate-status"
							label={t('device.migrate.status')}
							value={status()}
							onChange={setStatus}
							options={STATUSES.map((value) => ({
								value,
								label: deviceStatusLabel(value),
							}))}
							emptyLabel={t('device.migrate.keepStatus')}
						/>

						<div class="modal-actions">
							<button type="submit" disabled={save.pending()}>
								{t('device.migrate.submit')}
							</button>
							<button
								type="button"
								onClick={props.on_close}
								disabled={save.pending()}
							>
								{t('common.cancel')}
							</button>
						</div>
					</form>
				</Show>
			</Show>
			<InlineError message={error()} alert />
		</Modal>
	)
}
