import { priorityLabel } from 'shared/src/priority'
import {
	type HolidayRegion,
	type ServiceLevelTarget,
	type ServiceWindow,
	WEEKDAYS,
	type Weekday,
} from 'shared/src/schemas'
import type { InputEventAndTarget } from 'shared/src/types'
import { createSignal, For, type JSX, Show } from 'solid-js'
import {
	create_service_level,
	fetch_priorities,
	fetch_service_level,
	type PriorityListRow,
	type ServiceLevelDetail,
	update_service_level,
} from '../../api/service_catalog'
import {
	DescriptionField,
	Field,
	FormPage,
	FormSection,
	Hint,
	NameField,
	SelectField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { durationUnitLabel, holidayRegionOptions } from '../../i18n/labels'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { createRows } from '../../lib/resource'
import { queryParam, useFormReturnRoute } from '../../lib/router'
import {
	DURATION_UNITS,
	type DurationUnit,
	splitMinutes,
	toMinutes,
	weekdayLabel,
} from '../../lib/service_level'

interface DayState {
	open: boolean
	from: string
	to: string
}

/** A typed whole number and its unit; an empty value means none. */
interface DurationState {
	value: string
	unit: DurationUnit
}

/** Typed target inputs of one priority; an empty response means no target. */
interface TargetState {
	response: DurationState
	resolution: DurationState
	/** Not editable in the form; kept so saving does not reset stored targets. */
	aroundTheClock: boolean
}

const EMPTY_DURATION: DurationState = { value: '', unit: 'hours' }

function durationOf(minutes: number | null): DurationState {
	return minutes === null ? EMPTY_DURATION : splitMinutes(minutes)
}

type Hours = Record<Weekday, DayState>

/** New service levels start with office hours Mon–Fri 08:00–17:00. */
function defaultHours(): Hours {
	return Object.fromEntries(
		WEEKDAYS.map((day) => [day, { open: day <= 5, from: '08:00', to: '17:00' }]),
	) as Hours
}

function hoursOf(windows: readonly ServiceWindow[]): Hours {
	const hours = Object.fromEntries(
		WEEKDAYS.map((day) => [day, { open: false, from: '08:00', to: '17:00' }]),
	) as Hours
	for (const w of windows) {
		hours[w.day] = { open: true, from: w.from, to: w.to }
	}
	return hours
}

const EMPTY_TARGET: TargetState = {
	response: EMPTY_DURATION,
	resolution: EMPTY_DURATION,
	aroundTheClock: false,
}

/** Whole number plus unit dropdown for one target duration. */
function DurationInput(props: {
	id: string
	label: string
	placeholder: string
	value: DurationState
	onChange: (value: DurationState) => void
}): JSX.Element {
	return (
		<div class="duration-input">
			<input
				id={props.id}
				type="number"
				min="1"
				step="1"
				value={props.value.value}
				placeholder={props.placeholder}
				aria-label={props.label}
				onInput={(e: InputEventAndTarget) =>
					props.onChange({ ...props.value, value: e.currentTarget.value })
				}
			/>
			<select
				aria-label={`${props.label} (${t('serviceLevel.unit')})`}
				value={props.value.unit}
				onChange={(e: Event & { currentTarget: HTMLSelectElement }) =>
					props.onChange({ ...props.value, unit: e.currentTarget.value as DurationUnit })
				}
			>
				<For each={DURATION_UNITS}>
					{(unit: DurationUnit): JSX.Element => (
						<option value={unit} selected={unit === props.value.unit}>
							{durationUnitLabel(unit)}
						</option>
					)}
				</For>
			</select>
		</div>
	)
}

/** Service level create (`id` omitted) or edit form. */
function ServiceLevelForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [description, setDescription] = createSignal('')
	const [holidayRegion, setHolidayRegion] = createSignal('')
	const [hours, setHours] = createSignal<Hours>(defaultHours())
	const [targets, setTargets] = createSignal<Record<number, TargetState>>({})
	const [priorities] = createRows(() => fetch_priorities({ limit: 200 }))
	const form = useEntityForm({
		id: props.id,
		load: fetch_service_level,
		fill: (row: ServiceLevelDetail) => {
			setName(row.name)
			setDescription(row.description ?? '')
			setHolidayRegion(row.holiday_region ?? '')
			setHours(hoursOf(row.service_hours))
			setTargets(
				Object.fromEntries(
					row.targets.map((stored) => [
						stored.priority_id,
						{
							response: durationOf(stored.response_minutes),
							resolution: durationOf(stored.resolution_minutes),
							aroundTheClock: stored.around_the_clock,
						},
					]),
				),
			)
		},
	})
	const prefix = form.editing ? 'service-level-edit' : 'service-level'
	const backTo = useFormReturnRoute('/service-levels', props.id)

	const day = (d: Weekday): DayState => hours()[d]
	const patchDay = (d: Weekday, patch: Partial<DayState>): void => {
		setHours({ ...hours(), [d]: { ...hours()[d], ...patch } })
	}
	const target = (priorityId: number): TargetState => targets()[priorityId] ?? EMPTY_TARGET
	const patchTarget = (priorityId: number, patch: Partial<TargetState>): void => {
		setTargets({ ...targets(), [priorityId]: { ...target(priorityId), ...patch } })
	}

	function serviceHours(): ServiceWindow[] {
		return WEEKDAYS.filter((d) => day(d).open).map((d) => ({
			day: d,
			from: day(d).from,
			to: day(d).to,
		}))
	}

	/** Checks the service windows; a message for the first bad one. */
	function hoursProblem(): string | null {
		for (const w of serviceHours()) {
			if ((w.from === '') !== (w.to === '') || (w.from !== '' && w.from >= w.to)) {
				return t('serviceLevel.windowInvalid', { day: weekdayLabel(w.day, 'long') })
			}
		}
		return null
	}

	/** Parsed targets, or the message of the first unparsable entry. */
	function parsedTargets(): ServiceLevelTarget[] | string {
		const out: ServiceLevelTarget[] = []
		for (const priority of priorities() ?? []) {
			const state = target(priority.id)
			const response = toMinutes(state.response.value, state.response.unit)
			const resolution = toMinutes(state.resolution.value, state.resolution.unit)
			if (response === null) {
				if (resolution !== null) {
					return t('serviceLevel.responseRequired', { priority: priority.name })
				}
				continue
			}
			if (response === undefined || resolution === undefined) {
				return t('serviceLevel.durationInvalid', { priority: priority.name })
			}
			if (resolution !== null && resolution < response) {
				return t('serviceLevel.resolutionTooShort', { priority: priority.name })
			}
			out.push({
				priority_id: priority.id,
				response_minutes: response,
				resolution_minutes: resolution,
				around_the_clock: state.aroundTheClock,
			})
		}
		return out
	}

	function reset(): void {
		setName('')
		setDescription('')
		setHolidayRegion('')
		setHours(defaultHours())
		setTargets({})
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		const parsed = parsedTargets()
		const region = holidayRegion() === '' ? null : (holidayRegion() as HolidayRegion)
		await submit_form({
			form,
			name: name(),
			validate: () => hoursProblem() ?? (typeof parsed === 'string' ? parsed : null),
			save: ({ name: trimmed }: FormValues) => {
				const values = {
					service_hours: serviceHours(),
					holiday_region: region,
					targets: parsed as ServiceLevelTarget[],
				}
				return id === undefined
					? create_service_level({
							name: trimmed,
							description: text(description()),
							...values,
						})
					: update_service_level(id, {
							name: trimmed,
							description: text(description()) ?? null,
							...values,
						})
			},
			navigateTo: backTo(),
			onSuccess: is_add_another_submit(e) ? reset : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('serviceLevel.editTitle') : t('serviceLevel.addTitle')}
			name={form.record()?.name}
			loadingText={t('serviceLevel.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('serviceLevel.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus={!form.editing}
			/>
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>

			<FormSection title={t('serviceLevel.serviceHours')}>
				<For each={WEEKDAYS}>
					{(d: Weekday): JSX.Element => (
						<Field label={weekdayLabel(d, 'long')} for={`${prefix}-day-${d}`}>
							<div class="service-window">
								<input
									id={`${prefix}-day-${d}`}
									type="checkbox"
									checked={day(d).open}
									aria-label={t('serviceLevel.dayOpen', {
										day: weekdayLabel(d, 'long'),
									})}
									onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
										patchDay(d, { open: e.currentTarget.checked })
									}
								/>
								<input
									type="time"
									value={day(d).from}
									disabled={!day(d).open}
									aria-label={t('serviceLevel.windowFrom', {
										day: weekdayLabel(d, 'long'),
									})}
									onInput={(e: InputEventAndTarget) =>
										patchDay(d, { from: e.currentTarget.value })
									}
								/>
								<span aria-hidden="true">–</span>
								<input
									type="time"
									value={day(d).to}
									disabled={!day(d).open}
									aria-label={t('serviceLevel.windowTo', {
										day: weekdayLabel(d, 'long'),
									})}
									onInput={(e: InputEventAndTarget) =>
										patchDay(d, { to: e.currentTarget.value })
									}
								/>
								<Show when={!day(d).open}>
									<span class="field-hint">{t('serviceLevel.closed')}</span>
								</Show>
								<Show when={day(d).open && day(d).from === '' && day(d).to === ''}>
									<span class="field-hint">{t('serviceLevel.allDay')}</span>
								</Show>
							</div>
						</Field>
					)}
				</For>
				<SelectField
					id={`${prefix}-holiday-region`}
					label={t('serviceLevel.holidayRegion')}
					value={holidayRegion()}
					onChange={setHolidayRegion}
					options={holidayRegionOptions()}
					emptyLabel={t('serviceLevel.holidayNationwide')}
				/>
			</FormSection>

			<FormSection title={t('serviceLevel.targets')}>
				<div class="form-wide">
					<Show
						when={(priorities() ?? []).length > 0}
						fallback={
							<Hint>
								{t('serviceLevel.noPriorities')}{' '}
								<a href="/priorities/add">
									{t('app.navAdd', { label: tp('entity.priority', 1) })}
								</a>
							</Hint>
						}
					>
						<table class="service-targets">
							<thead>
								<tr>
									<th>{tp('entity.priority', 1)}</th>
									<th>{t('serviceLevel.response')}</th>
									<th>{t('serviceLevel.resolution')}</th>
								</tr>
							</thead>
							<tbody>
								<For each={priorities()}>
									{(priority: PriorityListRow): JSX.Element => (
										<tr>
											<td>{priorityLabel(priority)}</td>
											<td>
												<DurationInput
													id={`${prefix}-response-${priority.id}`}
													label={`${t('serviceLevel.response')} ${priority.name}`}
													placeholder={t('serviceLevel.noTarget')}
													value={target(priority.id).response}
													onChange={(response: DurationState) =>
														patchTarget(priority.id, { response })
													}
												/>
											</td>
											<td>
												<DurationInput
													id={`${prefix}-resolution-${priority.id}`}
													label={`${t('serviceLevel.resolution')} ${priority.name}`}
													placeholder={t('serviceLevel.bestEffort')}
													value={target(priority.id).resolution}
													onChange={(resolution: DurationState) =>
														patchTarget(priority.id, { resolution })
													}
												/>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</Show>
				</div>
			</FormSection>
		</FormPage>
	)
}

/** /service-levels/add — service level create form. */
export function ServiceLevelAddPage(): JSX.Element {
	return <ServiceLevelForm />
}

/** /service-levels/:id/edit — service level edit form. Saves back to the list when opened from it. */
export function ServiceLevelEditPage(props: { id: number }): JSX.Element {
	return <ServiceLevelForm id={props.id} />
}
