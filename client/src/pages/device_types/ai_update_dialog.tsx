import { IconCopy } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type {
	DeviceTypeUpdateChange,
	DeviceTypeUpdatePort,
	DeviceTypeUpdatePreview,
	PoeType,
} from 'shared/src/types'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { fetch_device_roles } from '../../api/device_roles'
import {
	apply_device_type_update,
	fetch_device_type_yaml,
	preview_device_type_update,
} from '../../api/templates'
import { InlineError } from '../../components/feedback'
import { Field, Hint } from '../../components/form'
import { Modal } from '../../components/modal'
import { t } from '../../i18n'
import {
	deviceTypeUpdateFieldLabel,
	poeModeLabel,
	poeTypeLabel,
	portKindLabel,
	portSideLabel,
	yesNo,
} from '../../i18n/labels'
import { createRecord, createRows, useAction } from '../../lib/resource'
import { buildAiUpdatePrompt } from './ai-prompt'

function fieldValue(field: DeviceTypeUpdateChange['field'], value: string): string {
	switch (field) {
		case 'kind':
			return portKindLabel(value)
		case 'poe_mode':
			return poeModeLabel(value)
		case 'poe_type':
			return poeTypeLabel(value as PoeType)
		case 'is_full_depth':
			return yesNo(value === 'true')
		default:
			return value
	}
}

function changeText(change: DeviceTypeUpdateChange): string {
	const value = (raw: string | null): string =>
		raw === null ? '—' : fieldValue(change.field, raw)
	return t('device.templateSync.change', {
		field: deviceTypeUpdateFieldLabel(change.field),
		from: value(change.from),
		to: value(change.to),
	})
}

/** Port name with its side, as front and rear ports may share a name. */
function portLabel(port: DeviceTypeUpdatePort): string {
	return port.side === null ? port.name : `${port.name} (${portSideLabel(port.side)})`
}

function PortList(props: { title: string; ports: DeviceTypeUpdatePort[] }): JSX.Element {
	return (
		<Show when={props.ports.length > 0}>
			<h3>{props.title}</h3>
			<ul class="template-sync-list">
				<For each={props.ports}>
					{(port: DeviceTypeUpdatePort): JSX.Element => (
						<li>
							<code>{portLabel(port)}</code> {portKindLabel(port.kind)}
						</li>
					)}
				</For>
			</ul>
		</Show>
	)
}

function PreviewChanges(props: { preview: DeviceTypeUpdatePreview }): JSX.Element {
	const portsChange = (): boolean =>
		props.preview.added_ports.length +
			props.preview.removed_ports.length +
			props.preview.changed_ports.length >
		0
	return (
		<>
			<Show when={props.preview.fields.length > 0}>
				<h3>{t('deviceType.aiUpdate.fields', { count: props.preview.fields.length })}</h3>
				<ul class="template-sync-list">
					<For each={props.preview.fields}>
						{(change: DeviceTypeUpdateChange): JSX.Element => (
							<li>{changeText(change)}</li>
						)}
					</For>
				</ul>
			</Show>
			<PortList
				title={t('deviceType.aiUpdate.added', { count: props.preview.added_ports.length })}
				ports={props.preview.added_ports}
			/>
			<PortList
				title={t('deviceType.aiUpdate.removed', {
					count: props.preview.removed_ports.length,
				})}
				ports={props.preview.removed_ports}
			/>
			<Show when={props.preview.changed_ports.length > 0}>
				<h3>
					{t('deviceType.aiUpdate.changed', {
						count: props.preview.changed_ports.length,
					})}
				</h3>
				<ul class="template-sync-list">
					<For each={props.preview.changed_ports}>
						{(port: DeviceTypeUpdatePreview['changed_ports'][number]): JSX.Element => (
							<li>
								<code>{portLabel(port)}</code>{' '}
								{port.changes.map(changeText).join(', ')}
							</li>
						)}
					</For>
				</ul>
			</Show>
			<Show when={props.preview.unchanged_ports > 0}>
				<Hint>
					{t('deviceType.aiUpdate.unchanged', { count: props.preview.unchanged_ports })}
				</Hint>
			</Show>
			<Show when={portsChange() && props.preview.device_count > 0}>
				<Hint>
					{t('deviceType.aiUpdate.syncHint', { count: props.preview.device_count })}
				</Hint>
			</Show>
		</>
	)
}

/**
 * Refreshes an existing device type from AI-generated YAML: copy a prompt built
 * from the current definition, paste the answer, review the server's preview
 * and apply it. Editing the YAML discards the preview, so what gets applied is
 * always what was reviewed. `initial_yaml` skips the prompt step's paste.
 */
export function AiUpdateDialog(props: {
	device_type_id: number
	model: string
	initial_yaml?: string
	on_applied: () => void
	on_close: () => void
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [yaml, setYaml] = createSignal(props.initial_yaml ?? '')
	const [copied, setCopied] = createSignal(false)
	const [preview, setPreview] = createSignal<DeviceTypeUpdatePreview | null>(null)
	const [current] = createRecord(() => props.device_type_id, fetch_device_type_yaml, setError)
	const [roles] = createRows(fetch_device_roles, setError)
	const busy = useAction(setError)

	const nothingChanges = (p: DeviceTypeUpdatePreview): boolean =>
		p.fields.length + p.added_ports.length + p.removed_ports.length + p.changed_ports.length ===
		0

	async function copyPrompt(): Promise<void> {
		const base = current()
		if (!base) {
			return
		}
		setCopied(false)
		setCopied(
			await busy.run(() =>
				Result.tryPromise({
					try: () =>
						navigator.clipboard.writeText(
							buildAiUpdatePrompt(base.yaml, roles() ?? []),
						),
					catch: () => new Error(t('import.promptCopyFailed')),
				}),
			),
		)
	}

	async function review(): Promise<void> {
		if (!yaml().trim()) {
			setError(t('deviceType.aiUpdate.pasteFirst'))
			return
		}
		await busy.run(async () => {
			const res = await preview_device_type_update(props.device_type_id, yaml())
			if (Result.isOk(res)) {
				setPreview(res.value)
			}
			return res
		})
	}

	async function apply(reviewed: DeviceTypeUpdatePreview): Promise<void> {
		const applied = await busy.run(() =>
			apply_device_type_update(props.device_type_id, {
				yaml: yaml(),
				revision: reviewed.revision,
			}),
		)
		if (applied) {
			props.on_applied()
			return
		}
		// A refused apply may rest on a stale preview, so it has to be redone.
		setPreview(null)
	}

	function handleSubmit(e: SubmitEvent): void {
		e.preventDefault()
		const reviewed = preview()
		void (reviewed ? apply(reviewed) : review())
	}

	return (
		<Modal
			title={t('deviceType.aiUpdate.title', { name: props.model })}
			class="ai-update-dialog"
			on_close={props.on_close}
		>
			<form class="form-stacked" onSubmit={handleSubmit}>
				<Hint>{t('deviceType.aiUpdate.hint')}</Hint>
				<div class="form-actions">
					<button
						type="button"
						disabled={!current() || roles.loading || busy.pending()}
						onClick={() => void copyPrompt()}
					>
						<IconCopy size={16} aria-hidden="true" />{' '}
						{t('deviceType.aiUpdate.copyPrompt')}
					</button>
				</div>
				<Show when={copied()}>
					<p class="text-success" role="status">
						{t('import.promptCopied')}
					</p>
				</Show>
				<Field label={t('deviceType.aiUpdate.yaml')} for="ai-update-yaml">
					<textarea
						id="ai-update-yaml"
						class="ai-update-yaml"
						rows={10}
						value={yaml()}
						onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
							setYaml(e.currentTarget.value)
							setPreview(null)
						}}
					/>
				</Field>
				<Show when={preview()}>
					{(p: () => DeviceTypeUpdatePreview) => (
						<Show
							when={!nothingChanges(p())}
							fallback={<Hint>{t('deviceType.aiUpdate.upToDate')}</Hint>}
						>
							<PreviewChanges preview={p()} />
						</Show>
					)}
				</Show>
				<InlineError message={error()} alert />
				<div class="form-actions template-sync-actions">
					<Show
						when={preview()}
						fallback={
							<button type="submit" disabled={busy.pending()}>
								{busy.pending()
									? t('deviceType.aiUpdate.reviewing')
									: t('deviceType.aiUpdate.review')}
							</button>
						}
					>
						{(p: () => DeviceTypeUpdatePreview) => (
							<button type="submit" disabled={nothingChanges(p()) || busy.pending()}>
								{t('deviceType.aiUpdate.apply')}
							</button>
						)}
					</Show>
					<button type="button" onClick={props.on_close} disabled={busy.pending()}>
						{t('common.cancel')}
					</button>
				</div>
			</form>
		</Modal>
	)
}
