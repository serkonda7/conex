import { IconChevronDown, IconPlus } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import {
	MAX_POWER_DRAW,
	MAX_STUB_DIGITS,
	MAX_STUB_START,
	POE_MODES,
	POE_TYPES,
	type PoeMode,
	type PoeType,
	SELECTABLE_PASS_THROUGH_PORT_TYPES,
	trimStubPrefix,
} from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { create_stub, delete_stub, type StubRow, update_stub } from '../../api/templates'
import { InlineError } from '../../components/feedback'
import { Hint, SelectField, TextField } from '../../components/form'
import { IconLabel } from '../../components/icon_label'
import { Modal } from '../../components/modal'
import { type MessageKey, t } from '../../i18n'
import { poeModeLabel, poeTypeOption, portKindOption } from '../../i18n/labels'
import { useDismiss } from '../../lib/dismiss'
import { cleared, text } from '../../lib/form'
import { useAction } from '../../lib/resource'
import { COMPONENT_CLASSES, type ComponentClassInfo, sortableDigits, stubRange } from './components'
import { CassetteIcon, PatchPanelIcon } from './connector_icons'

const MAX_COUNT = 1024

/** Digits of the numbering select: none, then up to the widest count. */
const DIGIT_CHOICES = Array.from({ length: MAX_STUB_DIGITS }, (_, i) => i + 1)

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

/** Integer in `1..MAX_COUNT` from a number field, or null. */
function parseCount(value: string): number | null {
	const n = Number(value)
	return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? n : null
}

/** Connector drawing beside a component class name. */
export function ItemIcon(props: { icon: ComponentClassInfo['icon'] }): JSX.Element {
	return (
		<span class="add-component-icon" aria-hidden="true">
			<Dynamic component={props.icon} />
		</span>
	)
}

/**
 * Warning atop the component forms: stubs only apply to devices created later.
 * Hidden when the type has no devices yet.
 */
function ExistingDevicesWarning(props: { count: number }): JSX.Element {
	return (
		<Show when={props.count > 0}>
			<p class="form-warning" role="status">
				{t('deviceType.component.existingDevicesHint', { count: props.count })}
			</p>
		</Show>
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

	return (
		<div class="add-component-menu">
			<button
				type="button"
				class="btn-add"
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
								<ItemIcon icon={info.icon} />
								{t(info.label)}
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
								<ItemIcon icon={preset.icon} />
								{t(preset.label)}
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
 * with a count (count N > 1 expands to `name1..nameN`) and the class's
 * kind. Rear ports add their positions, front ports the rear
 * port they map onto and the first position they take there, power inputs
 * their maximum draw, and network interfaces their PoE mode and type.
 */
export function ComponentDialog(props: {
	deviceTypeId: number
	/** Devices already built from the type. */
	existingDevices: number
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
	const [start, setStart] = createSignal(String(stub?.start ?? 1))
	/** Picked digits; unset on a new component, which then pads to the last number's width. */
	const [pickedDigits, setPickedDigits] = createSignal<number | null>(stub?.digits ?? null)
	const [positions, setPositions] = createSignal(String(stub?.positions ?? 1))
	const [rearStub, setRearStub] = createSignal(
		String(stub?.rear_stub_id ?? props.rearStubs[0]?.id ?? ''),
	)
	const [rearPosition, setRearPosition] = createSignal(String(stub?.rear_position ?? 1))
	const [kind, setKind] = createSignal<string>(
		stub?.kind ??
			(props.info.key === 'interface' ? '1000base-t' : (props.info.kinds[0] ?? 'port')),
	)
	const [maximumDraw, setMaximumDraw] = createSignal(String(stub?.maximum_draw ?? ''))
	const [poeMode, setPoeMode] = createSignal<PoeMode | ''>(stub?.poe_mode ?? '')
	const [poeType, setPoeType] = createSignal<PoeType | ''>(stub?.poe_type ?? '')
	const [error, setError] = createSignal<string | null>(null)
	const save = useAction(setError)
	const prefix = `${stub ? 'edit' : 'add'}-${props.info.key}`
	const isPowerInput = props.info.key === 'power-port'
	const isInterface = props.info.key === 'interface'
	// Stored kinds are free-form: keep an imported kind selectable.
	const kinds: readonly string[] =
		stub && !(props.info.kinds as readonly string[]).includes(stub.kind)
			? [stub.kind, ...props.info.kinds]
			: props.info.kinds

	const parsedCount = (): number => Number(count())
	const countValid = (): boolean =>
		Number.isInteger(parsedCount()) && parsedCount() >= 1 && parsedCount() <= MAX_COUNT

	const parsedStart = (): number => Number(start())
	const startValid = (): boolean =>
		Number.isInteger(parsedStart()) && parsedStart() >= 0 && parsedStart() <= MAX_STUB_START
	const digits = (): number =>
		pickedDigits() ??
		(countValid() && startValid() ? sortableDigits(parsedStart() + parsedCount() - 1) : 1)
	/** One trailing space stays: it separates name and number (`Port 01`). */
	const prefixInput = (): string => trimStubPrefix(name())

	/** Names the current input expands to, shown under the name field. */
	const preview = (): string | undefined =>
		prefixInput().trim() && countValid() && startValid()
			? stubRange({
					prefix: prefixInput(),
					count: parsedCount(),
					digits: digits(),
					start: parsedStart(),
				})
			: undefined

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const side = props.info.side
		const parsedPositions = parseCount(positions())
		const parsedRearPosition = parseCount(rearPosition())
		if (!countValid() || parsedPositions === null || parsedRearPosition === null) {
			setError(t('deviceType.component.countInvalid', { max: MAX_COUNT }))
			return
		}
		if (!startValid()) {
			setError(t('deviceType.component.startInvalid', { max: MAX_STUB_START }))
			return
		}
		if (side === 'front' && !rearStub()) {
			setError(t('deviceType.component.rearPortRequired'))
			return
		}
		const draw = text(maximumDraw())
		const parsedDraw = draw === undefined ? undefined : Number(draw)
		if (
			isPowerInput &&
			parsedDraw !== undefined &&
			!(Number.isInteger(parsedDraw) && parsedDraw >= 1 && parsedDraw <= MAX_POWER_DRAW)
		) {
			setError(t('deviceType.component.maximumDrawInvalid', { max: MAX_POWER_DRAW }))
			return
		}
		const fields = {
			count: parsedCount(),
			digits: digits(),
			start: parsedStart(),
			kind: kind(),
			...(isPowerInput ? { maximum_draw: parsedDraw } : {}),
			...(isInterface
				? {
						poe_mode: poeMode() || undefined,
						poe_type: (poeMode() && poeType()) || undefined,
					}
				: {}),
		}
		const trimmed = prefixInput()
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
				<ExistingDevicesWarning count={props.existingDevices} />
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
				<Show when={countValid() && parsedCount() > 1}>
					<TextField
						id={`${prefix}-start`}
						label={t('deviceType.component.start')}
						type="number"
						required
						min={0}
						max={MAX_STUB_START}
						step={1}
						inputmode="numeric"
						value={start()}
						onInput={setStart}
					/>
					<SelectField
						id={`${prefix}-digits`}
						label={t('deviceType.component.digits')}
						value={String(digits())}
						onChange={(value: string): void => {
							setPickedDigits(Number(value))
						}}
						options={DIGIT_CHOICES.map((n) => ({
							value: String(n),
							label: t('deviceType.component.digitsExample', {
								first: '1'.padStart(n, '0'),
								second: '2'.padStart(n, '0'),
							}),
						}))}
						hint={<Hint>{t('deviceType.component.digitsHint')}</Hint>}
					/>
				</Show>
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
							label: stubRange(r),
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
					class="combobox-fit combobox-port-kind"
					options={kinds.map(portKindOption)}
				/>
				<Show when={isPowerInput}>
					<TextField
						id={`${prefix}-maximum-draw`}
						label={t('deviceType.component.maximumDraw')}
						type="number"
						min={1}
						max={MAX_POWER_DRAW}
						step={1}
						inputmode="numeric"
						value={maximumDraw()}
						onInput={setMaximumDraw}
					/>
				</Show>
				<Show when={isInterface}>
					<SelectField
						id={`${prefix}-poe-mode`}
						label={t('deviceType.component.poeMode')}
						value={poeMode()}
						onChange={(value: string): void => {
							setPoeMode(value as PoeMode | '')
							if (!value) {
								setPoeType('')
							}
						}}
						emptyLabel={t('deviceType.component.noPoe')}
						options={POE_MODES.map((value) => ({
							value,
							label: poeModeLabel(value),
						}))}
					/>
					<SelectField
						id={`${prefix}-poe-type`}
						label={t('deviceType.component.poeType')}
						value={poeType()}
						onChange={(value: string): void => {
							setPoeType(value as PoeType | '')
						}}
						disabled={!poeMode()}
						emptyLabel={t('deviceType.component.noPoeType')}
						class="combobox-fit"
						options={POE_TYPES.map(poeTypeOption)}
					/>
				</Show>
				<div class="modal-actions">
					<button type="button" onClick={props.onClose}>
						{t('common.cancel')}
					</button>
					<button type="submit" disabled={!name().trim() || save.pending()}>
						{stub ? t('common.save') : t('common.create')}
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
	/** Devices already built from the type. */
	existingDevices: number
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
		const front = trimStubPrefix(name())
		const digits = sortableDigits(n)
		const ok = await save.run(async () => {
			const rear = await create_stub(props.deviceTypeId, {
				prefix: cassette ? rearName().trim() : front,
				count: cassette ? 1 : n,
				digits: cassette ? 1 : digits,
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
				digits,
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
				<ExistingDevicesWarning count={props.existingDevices} />
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
					class="combobox-port-kind"
					options={SELECTABLE_PASS_THROUGH_PORT_TYPES.map(portKindOption)}
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
					<button type="button" onClick={props.onClose}>
						{t('common.cancel')}
					</button>
					<button type="submit" disabled={!name().trim() || save.pending()}>
						{t('common.create')}
					</button>
				</div>
			</form>
			<InlineError message={error()} alert />
		</Modal>
	)
}
