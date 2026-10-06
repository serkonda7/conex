import { IconPlus, IconTrash } from '@tabler/icons-solidjs'
import { inferPhoneType } from 'shared/src/phone'
import type {
	ContactScope,
	InputEventAndTarget,
	PhoneType,
	TenantEmail,
	TenantPhone,
} from 'shared/src/types'
import { For, Index, type JSX, Show } from 'solid-js'
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
 * per entry with a remove button, plus an add button below. Rows keep their
 * DOM nodes by index, so typing never loses focus.
 */
export function ContactListField<T>(props: {
	id: string
	label: string
	addLabel: string
	rows: T[]
	onChange: (rows: T[]) => void
	blank: () => T
	row: (entry: () => T, update: (patch: Partial<T>) => void, index: number) => JSX.Element
}): JSX.Element {
	const update = (index: number, patch: Partial<T>): void =>
		props.onChange(props.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
	return (
		<Field label={props.label} for={`${props.id}-0`}>
			<Index each={props.rows}>
				{(entry: () => T, index: number): JSX.Element => (
					<div class="contact-row">
						{props.row(entry, (patch: Partial<T>) => update(index, patch), index)}
						<button
							type="button"
							class="icon-btn"
							aria-label={t('employee.removeEntry')}
							title={t('employee.removeEntry')}
							onClick={() => props.onChange(props.rows.filter((_, i) => i !== index))}
						>
							<IconTrash size={16} />
						</button>
					</div>
				)}
			</Index>
			<button
				type="button"
				class="contact-add"
				onClick={() => props.onChange([...props.rows, props.blank()])}
			>
				<IconPlus size={14} aria-hidden="true" /> {props.addLabel}
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

/** Mail addresses, one per line with their scope; the first is marked primary. */
export function EmailList(props: {
	emails: (TenantEmail & { scope?: ContactScope })[]
}): JSX.Element {
	return (
		<Show when={props.emails.length > 0} fallback="—">
			<ul class="contact-list">
				<For each={props.emails}>
					{(
						e: TenantEmail & { scope?: ContactScope },
						index: () => number,
					): JSX.Element => (
						<li>
							<EmailLink email={e.address} />
							<Show when={e.scope}>
								{(scope: () => ContactScope): JSX.Element => (
									<>
										{' '}
										<span class="text-muted">{contactScopeLabel(scope())}</span>
									</>
								)}
							</Show>
							<Show when={index() === 0 && props.emails.length > 1}>
								{' '}
								<span class="badge">{t('employee.primary')}</span>
							</Show>
						</li>
					)}
				</For>
			</ul>
		</Show>
	)
}

/** Phone numbers, one per line with their kind (and scope, if any). */
export function PhoneList(props: {
	phones: (TenantPhone & { scope?: ContactScope })[]
}): JSX.Element {
	return (
		<Show when={props.phones.length > 0} fallback="—">
			<ul class="contact-list">
				<For each={props.phones}>
					{(p: TenantPhone & { scope?: ContactScope }): JSX.Element => (
						<li>
							<a href={`tel:${p.number.replace(/[^\d+]/g, '')}`}>{p.number}</a>{' '}
							<span class="text-muted">
								{phoneTypeLabel(p.type)}
								{p.scope ? ` · ${contactScopeLabel(p.scope)}` : ''}
							</span>
						</li>
					)}
				</For>
			</ul>
		</Show>
	)
}
