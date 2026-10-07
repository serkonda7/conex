import { IconMenu2, IconPlus, IconTrash } from '@tabler/icons-solidjs'
import { extensionNumber, inferPhoneType } from 'shared/src/phone'
import type {
	ContactScope,
	InputEventAndTarget,
	PhoneType,
	TenantEmail,
	TenantPhone,
} from 'shared/src/types'
import { createSignal, For, Index, type JSX, Show } from 'solid-js'
import { t } from '../i18n'
import { contactScopeLabel, phoneTypeLabel, phoneTypeOptions } from '../i18n/labels'
import { EmailLink } from '../pages/employees/list'
import { Field } from './form'

// ---------------------------------------------------------------------------
// Mail address / phone number lists shared by employees (with work/private
// scope) and tenants (company-wide main contact, no scope).
// ---------------------------------------------------------------------------

type SelectEvent = Event & { currentTarget: HTMLSelectElement }

/** Phone row being edited; `typePicked` once the type no longer follows the number. */
export type PhoneRow<P extends TenantPhone> = P & { typePicked?: boolean }

/** Loaded rows whose type differs from the inferred one keep it while editing. */
export const phoneRow = <P extends TenantPhone>(p: P): PhoneRow<P> => ({
	...p,
	typePicked: inferPhoneType(p.number) !== p.type,
})

/** Payload of edited rows: trimmed, blank rows dropped. */
export function emailsOf<E extends TenantEmail>(rows: E[]): E[] {
	return rows.map((e) => ({ ...e, address: e.address.trim() })).filter((e) => e.address !== '')
}

export function phonesOf<P extends TenantPhone>(rows: PhoneRow<P>[]): P[] {
	return rows
		.map(({ typePicked: _, ...p }) => ({ ...p, number: p.number.trim() }) as unknown as P)
		.filter((p) => p.number !== '')
}

/** Native `<select>` of a contact row. */
export function RowSelect<T extends string>(props: {
	label: string
	value: T
	options: { value: T; label: string }[]
	onChange: (value: T) => void
}): JSX.Element {
	return (
		<select
			aria-label={props.label}
			value={props.value}
			onChange={(e: SelectEvent): void => props.onChange(e.currentTarget.value as T)}
		>
			<For each={props.options}>
				{(o: { value: T; label: string }): JSX.Element => (
					<option value={o.value}>{o.label}</option>
				)}
			</For>
		</select>
	)
}

/**
 * Editable list of contact rows (mail addresses or phone numbers): one row
 * per entry with a drag handle (arrow keys move too) and a remove button,
 * plus an add button below. Rows keep their DOM nodes by index, so typing
 * never loses focus.
 */
export function ContactListField<T>(props: {
	id: string
	label: string
	addLabel: string
	rows: T[]
	onChange: (rows: T[]) => void
	blank: () => T
	row: (entry: () => T, update: (patch: Partial<T>) => void, index: number) => JSX.Element
	/** Note shown below a row, e.g. why its value is unusable. */
	rowHint?: (entry: () => T) => JSX.Element
}): JSX.Element {
	/** Row whose handle is pressed; only that row is draggable, not its inputs. */
	const [grabbed, setGrabbed] = createSignal<number | null>(null)
	const [dragging, setDragging] = createSignal<number | null>(null)
	let list: HTMLDivElement | undefined
	const update = (index: number, patch: Partial<T>): void =>
		props.onChange(props.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
	const move = (index: number, to: number): void => {
		const rows = [...props.rows]
		const [moved] = rows.splice(index, 1)
		rows.splice(to, 0, moved as T)
		props.onChange(rows)
	}
	const onHandleKey = (e: KeyboardEvent, index: number): void => {
		const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null
		if (to === null || to < 0 || to >= props.rows.length) {
			return
		}
		e.preventDefault()
		move(index, to)
		list?.querySelectorAll<HTMLElement>('.contact-handle')[to]?.focus()
	}
	return (
		<Field label={props.label} for={`${props.id}-0`}>
			<div
				class="contact-rows"
				classList={{ 'contact-rows-sortable': props.rows.length > 1 }}
				ref={list}
			>
				<Index each={props.rows}>
					{(entry: () => T, index: number): JSX.Element => (
						<>
							{/* biome-ignore lint/a11y/noStaticElementInteractions: drag target; the handle button moves rows by keyboard. */}
							<div
								class="contact-row"
								classList={{ 'contact-row-dragging': dragging() === index }}
								draggable={grabbed() === index}
								onDragStart={(e: DragEvent) => {
									e.dataTransfer?.setData('text/plain', '')
									setDragging(index)
								}}
								onDragEnd={() => {
									setDragging(null)
									setGrabbed(null)
								}}
								onDragOver={(e: DragEvent) => {
									const from = dragging()
									if (from === null) {
										return
									}
									e.preventDefault()
									if (from !== index) {
										move(from, index)
										setDragging(index)
									}
								}}
								onDrop={(e: DragEvent) => e.preventDefault()}
							>
								<Show when={props.rows.length > 1}>
									<button
										type="button"
										class="contact-handle"
										aria-label={t('employee.reorderEntry')}
										title={t('employee.reorderEntry')}
										onPointerDown={() => setGrabbed(index)}
										onPointerUp={() => setGrabbed(null)}
										onKeyDown={(e: KeyboardEvent) => onHandleKey(e, index)}
									>
										<IconMenu2 size={16} aria-hidden="true" />
									</button>
								</Show>
								<div class="contact-inputs">
									{props.row(
										entry,
										(patch: Partial<T>) => update(index, patch),
										index,
									)}
								</div>
								<button
									type="button"
									class="contact-remove"
									aria-label={t('employee.removeEntry')}
									title={t('employee.removeEntry')}
									onClick={() =>
										props.onChange(props.rows.filter((_, i) => i !== index))
									}
								>
									<IconTrash size={16} />
								</button>
							</div>
							{props.rowHint?.(entry)}
						</>
					)}
				</Index>
			</div>
			<button
				type="button"
				class="contact-add"
				aria-label={props.addLabel}
				title={props.addLabel}
				onClick={() => props.onChange([...props.rows, props.blank()])}
			>
				<IconPlus size={18} aria-hidden="true" />
			</button>
		</Field>
	)
}

/**
 * Mail address input of a contact row. `onComplete` runs on blur and on Enter,
 * before the browser validates the form, so it can still fix up the address.
 */
export function EmailInput(props: {
	id: string
	value: string
	placeholder?: string
	onInput: (address: string) => void
	onComplete?: () => void
}): JSX.Element {
	return (
		<input
			id={props.id}
			type="email"
			autocomplete="off"
			maxLength={200}
			aria-label={t('employee.email')}
			placeholder={props.placeholder}
			value={props.value}
			onInput={(e: InputEventAndTarget) => props.onInput(e.currentTarget.value)}
			onBlur={() => props.onComplete?.()}
			onKeyDown={(e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					props.onComplete?.()
				}
			}}
		/>
	)
}

/** Phone number input plus type select; the type follows the number until picked. */
export function PhoneInputs<P extends TenantPhone>(props: {
	id: string
	entry: () => PhoneRow<P>
	update: (patch: Partial<PhoneRow<P>>) => void
}): JSX.Element {
	return (
		<>
			<input
				id={props.id}
				type="tel"
				autocomplete="off"
				maxLength={200}
				aria-label={t('employee.phoneNumber')}
				value={props.entry().number}
				onInput={(e: InputEventAndTarget) => {
					const number = e.currentTarget.value
					const inferred = props.entry().typePicked ? null : inferPhoneType(number)
					props.update(
						(inferred === null ? { number } : { number, type: inferred }) as Partial<
							PhoneRow<P>
						>,
					)
				}}
			/>
			<RowSelect
				label={t('employee.phoneType')}
				value={props.entry().type}
				options={phoneTypeOptions()}
				onChange={(type: PhoneType) =>
					props.update({ type, typePicked: true } as Partial<PhoneRow<P>>)
				}
			/>
		</>
	)
}

/** Mail addresses, one per line with their scope (if any); the first is primary. */
export function EmailList(props: {
	emails: (TenantEmail & { scope?: ContactScope })[]
}): JSX.Element {
	return (
		<Show when={props.emails.length > 0} fallback="—">
			<ul class="contact-list">
				<For each={props.emails}>
					{(e: TenantEmail & { scope?: ContactScope }): JSX.Element => (
						<li>
							<EmailLink email={e.address} />
							<Show when={e.scope}>
								{(scope: () => ContactScope): JSX.Element => (
									<span class="text-muted">{contactScopeLabel(scope())}</span>
								)}
							</Show>
						</li>
					)}
				</For>
			</ul>
		</Show>
	)
}

/** Extension that can't be completed to a full number with `mainNumber`. */
export function isUndialableExtension(p: TenantPhone, mainNumber: string | null): boolean {
	return (
		p.type === 'extension' &&
		p.number.trim() !== '' &&
		extensionNumber(p.number, mainNumber) === null
	)
}

/**
 * Phone numbers, one per line with their kind and scope (if any) in own
 * columns. Extensions dial via `mainNumber`; without one they are marked.
 */
export function PhoneList(props: {
	phones: (TenantPhone & { scope?: ContactScope })[]
	mainNumber?: string | null
}): JSX.Element {
	const dial = (p: TenantPhone): string | null =>
		p.type === 'extension'
			? extensionNumber(p.number, props.mainNumber ?? null)
			: p.number.replace(/[^\d+]/g, '')
	return (
		<Show when={props.phones.length > 0} fallback="—">
			<ul
				class="contact-list"
				classList={{ 'contact-list-scoped': props.phones.some((p) => p.scope) }}
			>
				<For each={props.phones}>
					{(p: TenantPhone & { scope?: ContactScope }): JSX.Element => (
						<li>
							<Show
								when={dial(p)}
								fallback={
									<span>
										{p.number}{' '}
										<span
											class="text-danger"
											title={t('employee.extensionNoMainNumber')}
										>
											({t('employee.extensionNotDialable')})
										</span>
									</span>
								}
							>
								{(tel: () => string): JSX.Element => (
									<a href={`tel:${tel()}`}>{p.number}</a>
								)}
							</Show>
							<span class="text-muted">{phoneTypeLabel(p.type)}</span>
							<Show when={p.scope}>
								{(scope: () => ContactScope): JSX.Element => (
									<span class="text-muted">{contactScopeLabel(scope())}</span>
								)}
							</Show>
						</li>
					)}
				</For>
			</ul>
		</Show>
	)
}
