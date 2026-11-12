import type {
	PortSide,
	TemplateSyncAssignment,
	TemplateSyncChange,
	TemplateSyncPreview,
} from 'shared/src/types'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import { apply_template_sync, fetch_template_sync } from '../../api/devices'
import { InlineError, Loading } from '../../components/feedback'
import { Hint, SelectField } from '../../components/form'
import { Modal } from '../../components/modal'
import { t } from '../../i18n'
import { portKindLabel, portSideLabel, templateSyncFieldLabel } from '../../i18n/labels'
import { createRecord, useAction } from '../../lib/resource'

type Orphan = TemplateSyncPreview['orphaned'][number]

const NEXT = 'next'
const KEEP = 'keep'
const REMOVE = 'remove'
/** Select values of a remap target; the name follows the prefix. */
const MAP_PREFIX = 'map:'
const LINK_PREFIX = 'link:'

/** Name of the added port a choice takes, if any. */
function targetOf(choice: string): string | null {
	for (const prefix of [MAP_PREFIX, LINK_PREFIX]) {
		if (choice.startsWith(prefix)) {
			return choice.slice(prefix.length)
		}
	}
	return null
}

/** Port name with its side, as front and rear ports may share a name. */
function portLabel(port: { name: string; side: PortSide | null }): string {
	return port.side === null ? port.name : `${port.name} (${portSideLabel(port.side)})`
}

/**
 * A suggestion is taken as is, under the port's own name if it has a custom
 * one; otherwise a port is only removed by default when that loses nothing
 * the user documented (cable, room, floor plan).
 */
function defaultChoice(orphan: Orphan): string {
	if (orphan.suggestion !== null) {
		return `${orphan.linked ? LINK_PREFIX : MAP_PREFIX}${orphan.suggestion}`
	}
	return orphan.connected || orphan.located ? KEEP : REMOVE
}

function changeText(change: TemplateSyncChange): string {
	const value = (raw: string | null): string =>
		raw === null ? '—' : change.field === 'kind' ? portKindLabel(raw) : raw
	return t('device.templateSync.change', {
		field: templateSyncFieldLabel(change.field),
		from: value(change.from),
		to: value(change.to),
	})
}

/**
 * Previews how a device's ports would change to match its device type and
 * lets the user decide what happens to ports the type no longer has:
 * remapped ports keep their cables. The server re-validates on apply.
 */
export function TemplateSyncDialog(props: {
	device: { id: number; name: string }
	/** Another device still differs, so "Update & Next" can move on to it. */
	has_next: boolean
	/** `next`: the user asked to continue with the next device. */
	on_synced: (next: boolean) => void
	on_close: () => void
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [preview] = createRecord(() => props.device.id, fetch_template_sync, setError)
	const [choices, setChoices] = createSignal<Record<number, string>>({})
	const save = useAction(setError)

	const choiceOf = (orphan: Orphan): string =>
		choices()[orphan.interface_id] ?? defaultChoice(orphan)
	const taken = createMemo(
		() =>
			new Map(
				(preview()?.orphaned ?? []).flatMap((orphan) => {
					const target = targetOf(choiceOf(orphan))
					return target === null
						? []
						: [[`${orphan.side}:${target}`, orphan.interface_id] as const]
				}),
			),
	)
	/** Added ports of the orphan's side no other orphan is mapped to. */
	const optionsOf = (orphan: Orphan): { value: string; label: string }[] => [
		...(preview()?.added ?? [])
			.filter((port) => {
				const owner = taken().get(`${port.side}:${port.name}`)
				return (
					port.side === orphan.side &&
					(owner === undefined || owner === orphan.interface_id)
				)
			})
			.flatMap((port) => {
				const params = { name: port.name }
				return [
					{
						value: `${MAP_PREFIX}${port.name}`,
						label: t('device.templateSync.mapTo', params),
					},
					{
						value: `${LINK_PREFIX}${port.name}`,
						label: t('device.templateSync.linkTo', params),
					},
				]
			}),
		{ value: KEEP, label: t('device.templateSync.keep') },
		...(orphan.connected ? [] : [{ value: REMOVE, label: t('device.templateSync.remove') }]),
	]
	/** Added ports nothing is mapped onto; these get created. */
	const created = createMemo(() =>
		(preview()?.added ?? []).filter((port) => !taken().has(`${port.side}:${port.name}`)),
	)
	const upToDate = (): boolean => {
		const p = preview()
		return (
			p !== null &&
			p !== undefined &&
			p.updated.length === 0 &&
			p.orphaned.length === 0 &&
			p.added.length === 0
		)
	}
	const assignments = (): TemplateSyncAssignment[] =>
		(preview()?.orphaned ?? []).map((orphan) => {
			const choice = choiceOf(orphan)
			const target = targetOf(choice)
			return target === null
				? { interface_id: orphan.interface_id, action: choice as 'keep' | 'remove' }
				: {
						interface_id: orphan.interface_id,
						action: choice.startsWith(LINK_PREFIX) ? 'link' : 'map',
						target,
					}
		})

	async function handleApply(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const next = (e.submitter as HTMLButtonElement | null)?.value === NEXT
		const input = { assignments: assignments() }
		if (await save.run(() => apply_template_sync(props.device.id, input))) {
			props.on_synced(next)
		}
	}

	return (
		<Modal
			title={t('device.templateSync.title', { name: props.device.name })}
			class="template-sync-dialog"
			on_close={props.on_close}
		>
			<Show
				when={preview()}
				fallback={<Loading message={t('device.templateSync.loading')} />}
			>
				{(p: () => TemplateSyncPreview): JSX.Element => (
					<form class="form-stacked" onSubmit={handleApply}>
						<Show when={upToDate()}>
							<p>{t('device.templateSync.upToDate')}</p>
						</Show>
						<Show when={p().orphaned.length > 0}>
							<h3>
								{t('device.templateSync.orphaned', { count: p().orphaned.length })}
							</h3>
							<For each={p().orphaned}>
								{(orphan: Orphan): JSX.Element => (
									<SelectField
										id={`template-sync-${orphan.interface_id}`}
										label={portLabel(orphan)}
										value={choiceOf(orphan)}
										onChange={(value: string): void => {
											setChoices((all) => ({
												...all,
												[orphan.interface_id]: value,
											}))
										}}
										options={optionsOf(orphan)}
										hint={
											<Show when={orphan.connected || orphan.located}>
												<Hint>
													{[
														orphan.connected
															? t('device.templateSync.cabled')
															: null,
														orphan.located
															? t('device.templateSync.located')
															: null,
													]
														.filter((note) => note !== null)
														.join(' · ')}
												</Hint>
											</Show>
										}
									/>
								)}
							</For>
						</Show>
						<Show when={created().length > 0}>
							<h3>{t('device.templateSync.added', { count: created().length })}</h3>
							<ul class="template-sync-list">
								<For each={created()}>
									{(port: TemplateSyncPreview['added'][number]): JSX.Element => (
										<li>
											<code>{portLabel(port)}</code>{' '}
											{portKindLabel(port.kind)}
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={p().updated.length > 0}>
							<h3>
								{t('device.templateSync.updated', { count: p().updated.length })}
							</h3>
							<ul class="template-sync-list">
								<For each={p().updated}>
									{(
										port: TemplateSyncPreview['updated'][number],
									): JSX.Element => (
										<li>
											<code>{portLabel(port)}</code>{' '}
											{port.changes.map(changeText).join(', ')}
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={p().unchanged > 0}>
							<Hint>
								{t('device.templateSync.unchanged', { count: p().unchanged })}
							</Hint>
						</Show>
						<div class="form-actions template-sync-actions">
							<button
								type="button"
								onClick={props.on_close}
								disabled={save.pending()}
							>
								{t('common.cancel')}
							</button>
							<div class="btn-group">
								<button type="submit" disabled={upToDate() || save.pending()}>
									{t('device.templateSync.apply')}
								</button>
								<button
									type="submit"
									class="btn-outline"
									name="action"
									value={NEXT}
									disabled={!props.has_next || upToDate() || save.pending()}
								>
									{t('device.templateSync.applyNext')}
								</button>
							</div>
						</div>
					</form>
				)}
			</Show>
			<InlineError message={error()} alert />
		</Modal>
	)
}
