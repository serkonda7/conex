import { IconCheck, IconUnlink } from '@tabler/icons-solidjs'
import type { JSX } from 'solid-js'
import { createMemo, createSignal, For, Show } from 'solid-js'
import {
	create_jack,
	delete_jack,
	type InterfaceJson,
	type PanelJackJson,
	update_jack,
} from '../../api/devices'
import { InlineError } from '../../components/feedback'
import { TextField } from '../../components/form'
import { Modal } from '../../components/modal'
import { t } from '../../i18n'
import { useAction } from '../../lib/resource'
import { isOutlet } from './outlet_location'

/** Default jack name: its port names (`12/13`). */
function jackName(ports: InterfaceJson[]): string {
	return ports.map((port) => port.name).join('/')
}

/** One existing jack: rename in place, or ungroup. */
function JackRow(props: {
	jack: PanelJackJson
	ports: InterfaceJson[]
	pending: boolean
	on_rename: (name: string) => void
	on_ungroup: () => void
}): JSX.Element {
	const [name, setName] = createSignal(props.jack.name)
	const changed = (): boolean => name().trim() !== '' && name().trim() !== props.jack.name
	return (
		<li class="jack-row">
			<input
				type="text"
				class="jack-row-name"
				value={name()}
				aria-label={t('device.jacks.rename', { name: props.jack.name })}
				onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
					setName(e.currentTarget.value)
				}
			/>
			<span class="jack-row-ports">
				<For each={props.ports}>{(port: InterfaceJson) => <code>{port.name}</code>}</For>
			</span>
			<Show when={changed()}>
				<button
					type="button"
					class="icon-btn"
					disabled={props.pending}
					title={t('device.jacks.rename', { name: props.jack.name })}
					aria-label={t('device.jacks.rename', { name: props.jack.name })}
					onClick={() => props.on_rename(name().trim())}
				>
					<IconCheck size={18} />
				</button>
			</Show>
			<button
				type="button"
				class="icon-btn icon-btn-danger"
				disabled={props.pending}
				title={t('device.jacks.ungroup', { name: props.jack.name })}
				aria-label={t('device.jacks.ungroup', { name: props.jack.name })}
				onClick={props.on_ungroup}
			>
				<IconUnlink size={18} />
			</button>
		</li>
	)
}

/**
 * Jacks of a patch panel: its outlets (single-position rear ports) grouped
 * behind one faceplate. Lists the jacks to rename or ungroup and groups
 * picked outlets into a new jack. Each change is saved right away.
 */
export function JackDialog(props: {
	device_id: number
	device_name: string
	ports: InterfaceJson[]
	jacks: PanelJackJson[]
	on_close: () => void
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const action = useAction(setError)
	const [picked, setPicked] = createSignal<ReadonlySet<number>>(new Set())
	const [name, setName] = createSignal('')
	const [nameEdited, setNameEdited] = createSignal(false)

	const outlets = createMemo(() => props.ports.filter(isOutlet))
	const freeOutlets = createMemo(() => outlets().filter((port) => port.jack_id === null))
	const portsOf = (jack: PanelJackJson): InterfaceJson[] =>
		outlets().filter((port) => port.jack_id === jack.id)
	const pickedPorts = (): InterfaceJson[] => freeOutlets().filter((port) => picked().has(port.id))
	const shownName = (): string => (nameEdited() ? name() : jackName(pickedPorts()))

	function toggle(id: number, on: boolean): void {
		const next = new Set(picked())
		if (on) {
			next.add(id)
		} else {
			next.delete(id)
		}
		setPicked(next)
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const ports = pickedPorts()
		const ok = await action.run(() =>
			create_jack(props.device_id, {
				name: shownName().trim(),
				interface_ids: ports.map((port) => port.id),
			}),
		)
		if (ok) {
			setPicked(new Set<number>())
			setName('')
			setNameEdited(false)
		}
	}

	return (
		<Modal
			title={t('device.jacks.title', { name: props.device_name })}
			class="jack-dialog"
			on_close={props.on_close}
		>
			<section class="jack-dialog-section">
				<h3>{t('entity.jack.other')}</h3>
				<Show when={props.jacks.length > 0} fallback={<p>{t('device.jacks.empty')}</p>}>
					<ul class="jack-list">
						<For each={props.jacks}>
							{(jack: PanelJackJson) => (
								<JackRow
									jack={jack}
									ports={portsOf(jack)}
									pending={action.pending()}
									on_rename={(next: string) =>
										void action.run(() =>
											update_jack(props.device_id, jack.id, { name: next }),
										)
									}
									on_ungroup={() =>
										void action.run(() => delete_jack(props.device_id, jack.id))
									}
								/>
							)}
						</For>
					</ul>
				</Show>
			</section>
			<Show
				when={freeOutlets().length >= 2}
				fallback={
					<Show when={outlets().length > 0}>
						<p>{t('device.jacks.noFreeOutlets')}</p>
					</Show>
				}
			>
				<section class="jack-dialog-section">
					<h3>{t('device.jacks.new')}</h3>
					<form class="form-stacked" onSubmit={handleCreate}>
						<div class="field">
							<span class="field-group-label" aria-hidden="true">
								{t('device.jacks.outlets')}
							</span>
							<fieldset class="jack-outlets field-control">
								<legend class="visually-hidden">{t('device.jacks.outlets')}</legend>
								<div
									class="jack-outlet-list"
									style={{
										'--jack-outlet-rows': Math.ceil(freeOutlets().length / 4),
										'--jack-outlet-rows-narrow': Math.ceil(
											freeOutlets().length / 2,
										),
									}}
								>
									<For each={freeOutlets()}>
										{(port: InterfaceJson) => (
											<label class="field-checkbox-label">
												<input
													type="checkbox"
													checked={picked().has(port.id)}
													onChange={(
														e: Event & {
															currentTarget: HTMLInputElement
														},
													) => toggle(port.id, e.currentTarget.checked)}
												/>
												<code>{port.name}</code>
											</label>
										)}
									</For>
								</div>
							</fieldset>
						</div>
						<TextField
							id="jack-name"
							label={t('common.name')}
							value={shownName()}
							onInput={(value: string) => {
								setName(value)
								setNameEdited(true)
							}}
							required
						/>
						<div class="modal-actions">
							<button
								type="submit"
								disabled={
									pickedPorts().length < 2 ||
									shownName().trim() === '' ||
									action.pending()
								}
							>
								{t('device.jacks.create')}
							</button>
						</div>
					</form>
				</section>
			</Show>
			<div class="modal-actions">
				<button type="button" onClick={props.on_close}>
					{t('common.close')}
				</button>
			</div>
			<InlineError message={error()} alert />
		</Modal>
	)
}
