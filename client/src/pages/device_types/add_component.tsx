import { IconChevronDown, IconPlus } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { PASS_THROUGH_PORT_TYPES, type PassThroughPortType } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { create_stub, delete_stub, type StubRow, update_stub } from '../../api/templates'
import { InlineError } from '../../components/feedback'
import {
	DescriptionField,
	Hint,
	SelectField,
	TextField,
	useCursorPreview,
} from '../../components/form'
import { IconLabel } from '../../components/icon_label'
import { Modal } from '../../components/modal'
import { type MessageKey, t } from '../../i18n'
import { portKindOption } from '../../i18n/labels'
import { useDismiss } from '../../lib/dismiss'
import { cleared, text } from '../../lib/form'
import { useAction } from '../../lib/resource'
import { COMPONENT_CLASSES, type ComponentClassInfo } from './components'
import { CassetteIcon, PatchPanelIcon } from './connector_icons'

const MAX_COUNT = 1024

/** Quick-add presets of patch-panel port pairs. */
export type PassThroughPreset = 'patch-panel' | 'cassette'

const PRESETS: readonly {
	key: PassThroughPreset
	label: MessageKey
	icon: ComponentClassInfo['icon']
}[] = [
	{ key: 'patch-panel', label: 'deviceType.preset.patchPanel', icon: PatchPanelIcon },
	{ key: 'cassette', label: 'deviceType.preset.cassette', icon: CassetteIcon },
]

const PASS_THROUGH_KINDS = Object.keys(PASS_THROUGH_PORT_TYPES) as PassThroughPortType[]

/** Integer in `1..MAX_COUNT` from a number field, or null. */
function parseCount(value: string): number | null {
	const n = Number(value)
	return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? n : null
}

/** Connector drawing that floats at the cursor while its menu item is hovered. */
function ItemPreview(props: { icon: ComponentClassInfo['icon'] }): JSX.Element {
	return (
		<span class="combobox-preview add-component-preview" aria-hidden="true">
			<Dynamic component={props.icon} />
		</span>
	)
}

/**
 * "Add components" button whose dropdown lists the component classes
 * (NetBox-style), followed by the patch-panel presets.
 */
export function AddComponentMenu(props: {
	onSelect: (info: ComponentClassInfo) => void
	onPreset: (preset: PassThroughPreset) => void
}): JSX.Element {
	const [open, setOpen] = createSignal(false)
	useDismiss('.add-component-menu', () => setOpen(false))
	useCursorPreview()

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
								<ItemPreview icon={info.icon} />
							</button>
						)}
					</For>
					<hr />
					<For each={PRESETS}>
						{(preset: (typeof PRESETS)[number]): JSX.Element => (
							<button
								type="button"
								role="menuitem"
								class="add-component-item"
								onClick={() => {
									setOpen(false)
									props.onPreset(preset.key)
								}}
							>
								{t(preset.label)}
								<ItemPreview icon={preset.icon} />
							</button>
						)}
					</For>
				</div>
			</Show>
		</div>
	)
}

/**
 * Add or edit form for one component class (edit when `stub` is given): a name
 * with a count (count N > 1 expands to `name1..nameN`), the class's kinds,
 * label and description. Rear ports add their positions, front ports the rear
 * port they map onto and the first position they take there.
 */
export function ComponentDialog(props: {
	deviceTypeId: number
	info: ComponentClassInfo
	/** Stub to edit; omitted when adding. */
	stub?: StubRow
	/** Rear port stubs of the type, offered to front ports. */
	rearStubs: StubRow[]
	onSaved: () => void
	onClose: () => void
}): JSX.Element {
	const stub = props.stub
	const [name, setName] = createSignal(stub?.prefix ?? '')
	const [count, setCount] = createSignal(String(stub?.count ?? 1))
	const [positions, setPositions] = createSignal(String(stub?.positions ?? 1))
	const [rearStub, setRearStub] = createSignal(
		String(stub?.rear_stub_id ?? props.rearStubs[0]?.id ?? ''),
	)
	const [rearPosition, setRearPosition] = createSignal(String(stub?.rear_position ?? 1))
	const [kind, setKind] = createSignal<string>(
		stub?.kind ??
			(props.info.key === 'interface' ? '1000base-t' : (props.info.kinds[0] ?? 'port')),
	)
	const [label, setLabel] = createSignal(stub?.label ?? '')
	const [description, setDescription] = createSignal(stub?.description ?? '')
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)
	const prefix = `${stub ? 'edit' : 'add'}-${props.info.key}`
	// Stored kinds are free-form: keep an imported kind selectable.
	const kinds: readonly string[] =
		stub && !(props.info.kinds as readonly string[]).includes(stub.kind)
			? [stub.kind, ...props.info.kinds]
			: props.info.kinds

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
		const side = props.info.side
		const parsedPositions = parseCount(positions())
		const parsedRearPosition = parseCount(rearPosition())
		if (!countValid() || parsedPositions === null || parsedRearPosition === null) {
			setError(t('deviceType.component.countInvalid', { max: MAX_COUNT }))
			return
		}
		if (side === 'front' && !rearStub()) {
			setError(t('deviceType.component.rearPortRequired'))
			return
		}
		const fields = {
			count: parsedCount(),
			kind: kind(),
			label: text(label()),
			description: text(description()),
		}
		const trimmed = name().trim()
		const passThrough = {
			...(side === 'rear' ? { positions: parsedPositions } : {}),
			...(side === 'front'
				? { rear_stub_id: Number(rearStub()), rear_position: parsedRearPosition }
				: {}),
		}
		const ok = await save.run(() =>
			stub
				? update_stub(props.deviceTypeId, stub.id, {
						...cleared(fields),
						...passThrough,
						// Imported names may fall outside the prefix schema: only a
						// rename is validated against it.
						...(trimmed === stub.prefix ? {} : { prefix: trimmed }),
					})
				: create_stub(props.deviceTypeId, {
						...fields,
						...passThrough,
						prefix: trimmed,
						...(side ? { side } : {}),
					}),
		)
		if (ok) {
			props.onSaved()
		}
	}

	return (
		<Modal
			title={
				stub
					? t('deviceType.component.editTitle', { name: stub.prefix })
					: t('deviceType.component.addTitle', { component: t(props.info.label) })
			}
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
				<Show when={props.info.side === 'rear'}>
					<TextField
						id={`${prefix}-positions`}
						label={t('deviceType.component.positions')}
						type="number"
						required
						min={1}
						max={MAX_COUNT}
						step={1}
						inputmode="numeric"
						value={positions()}
						onInput={setPositions}
						hint={<Hint>{t('deviceType.component.positionsHint')}</Hint>}
					/>
				</Show>
				<Show when={props.info.side === 'front'}>
					<SelectField
						id={`${prefix}-rear`}
						label={t('deviceType.component.rearPort')}
						required
						value={rearStub()}
						onChange={setRearStub}
						emptyLabel={
							props.rearStubs.length === 0
								? t('deviceType.component.noRearPorts')
								: undefined
						}
						options={props.rearStubs.map((r) => ({
							value: String(r.id),
							label:
								r.count === 1
									? r.prefix
									: t('deviceType.component.range', {
											first: `${r.prefix}1`,
											last: `${r.prefix}${r.count}`,
										}),
						}))}
					/>
					<TextField
						id={`${prefix}-rear-position`}
						label={t('deviceType.component.rearPosition')}
						type="number"
						required
						min={1}
						max={MAX_COUNT}
						step={1}
						inputmode="numeric"
						value={rearPosition()}
						onInput={setRearPosition}
						hint={<Hint>{t('deviceType.component.rearPositionHint')}</Hint>}
					/>
				</Show>
				<SelectField
					id={`${prefix}-kind`}
					label={t('common.type')}
					required
					value={kind()}
					onChange={setKind}
					class="combobox-fit"
					options={kinds.map(portKindOption)}
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
						{stub ? t('common.save') : t('common.create')}
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

/**
 * Quick-add of a front/rear port set: a patch panel pairs N front ports
 * with N single-position rear ports (N:N), a cassette maps N front ports
 * onto the N positions of one MPO rear port (N:1×N). The rear stub is
 * created first; the front stub then maps onto it from position 1.
 */
export function PassThroughPresetDialog(props: {
	deviceTypeId: number
	preset: PassThroughPreset
	onSaved: () => void
	onClose: () => void
}): JSX.Element {
	const cassette = props.preset === 'cassette'
	const [name, setName] = createSignal('')
	const [count, setCount] = createSignal(cassette ? '12' : '24')
	const [kind, setKind] = createSignal<string>(cassette ? 'lc' : '8p8c')
	const [rearName, setRearName] = createSignal('MPO')
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)
	const prefix = `preset-${props.preset}`

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const n = parseCount(count())
		if (n === null) {
			setError(t('deviceType.component.countInvalid', { max: MAX_COUNT }))
			return
		}
		const front = name().trim()
		const ok = await save.run(async () => {
			const rear = await create_stub(props.deviceTypeId, {
				prefix: cassette ? rearName().trim() : front,
				count: cassette ? 1 : n,
				kind: cassette ? 'mpo' : kind(),
				side: 'rear',
				positions: cassette ? n : 1,
			})
			if (Result.isError(rear)) {
				return rear
			}
			const created = await create_stub(props.deviceTypeId, {
				prefix: front,
				count: n,
				kind: kind(),
				side: 'front',
				rear_stub_id: rear.value.id,
				rear_position: 1,
			})
			if (Result.isError(created)) {
				// Keep the template free of a half-added set.
				await delete_stub(props.deviceTypeId, rear.value.id)
			}
			return created
		})
		if (ok) {
			props.onSaved()
		}
	}

	return (
		<Modal
			title={t(cassette ? 'deviceType.preset.cassette' : 'deviceType.preset.patchPanel')}
			on_close={props.onClose}
		>
			<form class="form-stacked" onSubmit={handleSubmit}>
				<TextField
					id={`${prefix}-name`}
					label={t('deviceType.preset.frontName')}
					placeholder="Port"
					maxLength={50}
					required
					autofocus
					value={name()}
					onInput={setName}
					hint={<Hint>{t('deviceType.preset.nameHint')}</Hint>}
				/>
				<TextField
					id={`${prefix}-count`}
					label={t(cassette ? 'deviceType.preset.fibers' : 'deviceType.component.count')}
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
					label={t('deviceType.preset.frontType')}
					required
					value={kind()}
					onChange={setKind}
					options={PASS_THROUGH_KINDS.map(portKindOption)}
				/>
				<Show when={cassette}>
					<TextField
						id={`${prefix}-rear-name`}
						label={t('deviceType.preset.rearName')}
						maxLength={50}
						required
						value={rearName()}
						onInput={setRearName}
					/>
				</Show>
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
