import { IconChevronDown, IconPlus } from '@tabler/icons-solidjs'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { create_stub } from '../../api/templates'
import { InlineError } from '../../components/feedback'
import { DescriptionField, Hint, SelectField, TextField } from '../../components/form'
import { IconLabel } from '../../components/icon_label'
import { Modal } from '../../components/modal'
import { t } from '../../i18n'
import { portKindLabel } from '../../i18n/labels'
import { useDismiss } from '../../lib/dismiss'
import { text } from '../../lib/form'
import { useAction } from '../../lib/resource'
import { COMPONENT_CLASSES, type ComponentClassInfo } from './components'

const MAX_COUNT = 1024

/** "Add components" button whose dropdown lists the component classes (NetBox-style). */
export function AddComponentMenu(props: {
	onSelect: (info: ComponentClassInfo) => void
}): JSX.Element {
	const [open, setOpen] = createSignal(false)
	useDismiss('.add-component-menu', () => setOpen(false))

	return (
		<div class="add-component-menu">
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={open()}
				onClick={() => setOpen(!open())}
				onKeyDown={(e: KeyboardEvent): void => {
					if (e.key === 'Escape') {
						setOpen(false)
					}
				}}
			>
				<IconLabel icon={IconPlus}>{t('deviceType.addComponents')}</IconLabel>
				<IconChevronDown size={14} aria-hidden="true" />
			</button>
			<Show when={open()}>
				<div class="add-component-dropdown" role="menu">
					<For each={COMPONENT_CLASSES}>
						{(info: ComponentClassInfo) => (
							<button
								type="button"
								role="menuitem"
								class="add-component-item"
								onClick={() => {
									setOpen(false)
									props.onSelect(info)
								}}
							>
								{t(info.label)}
							</button>
						)}
					</For>
				</div>
			</Show>
		</div>
	)
}

/**
 * Add form for one component class: a name with a count (count N > 1 expands
 * to `name1..nameN`), the class's kinds, label and description.
 */
export function AddComponentDialog(props: {
	deviceTypeId: number
	info: ComponentClassInfo
	onSaved: () => void
	onClose: () => void
}): JSX.Element {
	const [name, setName] = createSignal('')
	const [count, setCount] = createSignal('1')
	const [kind, setKind] = createSignal<string>(props.info.kinds[0] ?? 'ethernet')
	const [label, setLabel] = createSignal('')
	const [description, setDescription] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)
	const prefix = `add-${props.info.key}`

	const parsedCount = (): number => Number(count())
	const countValid = (): boolean =>
		Number.isInteger(parsedCount()) && parsedCount() >= 1 && parsedCount() <= MAX_COUNT

	/** Names the current input expands to, shown under the name field. */
	const preview = (): string | undefined => {
		const trimmed = name().trim()
		if (!trimmed || !countValid()) {
			return undefined
		}
		const n = parsedCount()
		return n === 1
			? trimmed
			: t('deviceType.component.range', { first: `${trimmed}1`, last: `${trimmed}${n}` })
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		if (!countValid()) {
			setError(t('deviceType.component.countInvalid', { max: MAX_COUNT }))
			return
		}
		const ok = await save.run(() =>
			create_stub(props.deviceTypeId, {
				prefix: name().trim(),
				count: parsedCount(),
				kind: kind(),
				label: text(label()),
				description: text(description()),
			}),
		)
		if (ok) {
			props.onSaved()
		}
	}

	return (
		<Modal
			title={t('deviceType.component.addTitle', { component: t(props.info.label) })}
			on_close={props.onClose}
		>
			<form class="form-stacked" onSubmit={handleSubmit}>
				<TextField
					id={`${prefix}-name`}
					label={t('common.name')}
					placeholder={props.info.placeholder}
					maxLength={50}
					required
					autofocus
					value={name()}
					onInput={setName}
					hint={
						<Show when={preview()}>
							{(names: () => string) => <Hint>{names()}</Hint>}
						</Show>
					}
				/>
				<TextField
					id={`${prefix}-count`}
					label={t('deviceType.component.count')}
					type="number"
					required
					min={1}
					max={MAX_COUNT}
					step={1}
					inputmode="numeric"
					value={count()}
					onInput={setCount}
				/>
				<SelectField
					id={`${prefix}-kind`}
					label={t('common.type')}
					required
					value={kind()}
					onChange={setKind}
					options={props.info.kinds.map((k) => ({
						value: k,
						label: portKindLabel(k),
					}))}
				/>
				<TextField
					id={`${prefix}-label`}
					label={t('deviceType.component.label')}
					maxLength={200}
					value={label()}
					onInput={setLabel}
				/>
				<DescriptionField
					id={`${prefix}-description`}
					value={description()}
					onInput={setDescription}
				/>
				<div class="modal-actions">
					<button type="submit" disabled={!name().trim() || save.pending()}>
						{t('common.create')}
					</button>
					<button type="button" onClick={props.onClose}>
						{t('common.cancel')}
					</button>
				</div>
			</form>
			<InlineError message={error()} alert />
		</Modal>
	)
}
