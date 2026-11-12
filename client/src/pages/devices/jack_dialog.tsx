import { IconPencil, IconUnlink } from '@tabler/icons-solidjs'
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
import { isOutlet } from './outlet'

/** Default jack name: its port names without leading zeros (`03` + `04` → `3/4`). */
function jackName(ports: InterfaceJson[]): string {
	return ports.map((port) => port.name.replace(/^0+(?=\d)/, '')).join('/')
}

/** One existing jack: edit it in the form below, or ungroup it. */
function JackRow(props: {
	jack: PanelJackJson
	ports: InterfaceJson[]
	editing: boolean
	pending: boolean
	on_edit: () => void
	on_ungroup: () => void
}): JSX.Element {
	return (
		<li class="jack-row" classList={{ 'jack-row-editing': props.editing }}>
			<span class="jack-row-name">{props.jack.name}</span>
			<span class="jack-row-ports">
				<For each={props.ports}>{(port: InterfaceJson) => <code>{port.name}</code>}</For>
			</span>
			<button
				type="button"
				class="icon-btn"
				disabled={props.pending || props.editing}
				title={t('device.jacks.edit', { name: props.jack.name })}
				aria-label={t('device.jacks.edit', { name: props.jack.name })}
				onClick={props.on_edit}
			>
				<IconPencil size={18} />
			</button>
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

/** True when both lists hold the same ids, in any order. */
function sameIds(a: readonly number[], b: readonly number[]): boolean {
	const set = new Set(a)
	return set.size === new Set(b).size && b.every((id) => set.has(id))
}

/**
 * Jacks of a patch panel: its outlets (single-position rear ports) grouped
 * behind one faceplate. Lists the jacks to edit or ungroup and groups
 * picked outlets into a new jack; editing a jack loads it into the same
 * form, with its ports picked among the free outlets. Each change is saved
 * right away.
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
	const [editingId, setEditingId] = createSignal<number | null>(null)

	const outlets = createMemo(() => props.ports.filter(isOutlet))
	const freeOutlets = createMemo(() => outlets().filter((port) => port.jack_id === null))
	const portsOf = (jack: PanelJackJson): InterfaceJson[] =>
		outlets().filter((port) => port.jack_id === jack.id)
	/** The jack in the form, while it still exists. */
	const editing = createMemo(() => props.jacks.find((jack) => jack.id === editingId()) ?? null)
	/** Outlets to pick from: the free ones, plus the edited jack's. */
	const choices = createMemo(() => {
		const jack = editing()
		return outlets().filter(
			(port) => port.jack_id === null || (jack !== null && port.jack_id === jack.id),
		)
	})
	const pickedPorts = (): InterfaceJson[] => choices().filter((port) => picked().has(port.id))
	const shownName = (): string => (nameEdited() ? name() : jackName(pickedPorts()))
	/** Edit mode: true when the form differs from the edited jack. */
	const changed = (): boolean => {
		const jack = editing()
		return (
			jack !== null &&
			(shownName().trim() !== jack.name ||
				!sameIds(
					jack.interface_ids,
					pickedPorts().map((port) => port.id),
				))
		)
	}

	function toggle(id: number, on: boolean): void {
		const next = new Set(picked())
		if (on) {
			next.add(id)
		} else {
			next.delete(id)
		}
		setPicked(next)
	}

	function resetForm(): void {
		setEditingId(null)
		setPicked(new Set<number>())
		setName('')
		setNameEdited(false)
	}

	function startEdit(jack: PanelJackJson): void {
		setEditingId(jack.id)
		setPicked(new Set(jack.interface_ids))
		setName(jack.name)
		// A default name follows the picked ports, a custom one stays.
		setNameEdited(jack.name !== jackName(portsOf(jack)))
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const jack = editing()
		const ids = pickedPorts().map((port) => port.id)
		const trimmed = shownName().trim()
		const ok = await action.run(() =>
			jack
				? update_jack(props.device_id, jack.id, {
						name: trimmed !== jack.name ? trimmed : undefined,
						interface_ids: sameIds(jack.interface_ids, ids) ? undefined : ids,
					})
				: create_jack(props.device_id, { name: trimmed, interface_ids: ids }),
		)
		if (ok) {
			resetForm()
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
									editing={editing()?.id === jack.id}
									pending={action.pending()}
									on_edit={() => startEdit(jack)}
									on_ungroup={async () => {
										const ok = await action.run(() =>
											delete_jack(props.device_id, jack.id),
										)
										if (ok && editingId() === jack.id) {
											resetForm()
										}
									}}
								/>
							)}
						</For>
					</ul>
				</Show>
			</section>
			<Show
				when={editing() !== null || freeOutlets().length >= 2}
				fallback={
					<Show when={outlets().length > 0}>
						<p>{t('device.jacks.noFreeOutlets')}</p>
					</Show>
				}
			>
				<section class="jack-dialog-section">
					<h3>
						{editing()
							? t('device.jacks.edit', { name: editing()?.name ?? '' })
							: t('device.jacks.new')}
					</h3>
					<form class="form-stacked" onSubmit={handleSubmit}>
						<div class="field">
							<span class="field-group-label" aria-hidden="true">
								{t('device.jacks.outlets')}
							</span>
							<fieldset class="jack-outlets field-control">
								<legend class="visually-hidden">{t('device.jacks.outlets')}</legend>
								<div
									class="jack-outlet-list"
									style={{
										'--jack-outlet-rows': Math.ceil(choices().length / 4),
										'--jack-outlet-rows-narrow': Math.ceil(
											choices().length / 2,
										),
									}}
								>
									<For each={choices()}>
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
							<Show when={editing()}>
								<button type="button" onClick={resetForm}>
									{t('common.cancel')}
								</button>
							</Show>
							<button
								type="submit"
								disabled={
									pickedPorts().length < 2 ||
									shownName().trim() === '' ||
									(editing() !== null && !changed()) ||
									action.pending()
								}
							>
								{editing() ? t('common.save') : t('device.jacks.create')}
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
