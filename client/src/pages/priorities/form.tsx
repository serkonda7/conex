import { DEFAULT_PRIORITY_COLOR } from 'shared/src/schemas'
import type { InputEventAndTarget } from 'shared/src/types'
import { createSignal, type JSX } from 'solid-js'
import {
	create_priority,
	fetch_priority,
	type PriorityRow,
	update_priority,
} from '../../api/service_catalog'
import {
	DescriptionField,
	Field,
	FormPage,
	Hint,
	NameField,
	TextField,
} from '../../components/form'
import { PriorityPill } from '../../components/priority_pill'
import { t } from '../../i18n'
import {
	type FormValues,
	is_add_another_submit,
	submit_form,
	text,
	useEntityForm,
} from '../../lib/form'
import { queryParam, useFormReturnRoute } from '../../lib/router'

/** Priority create (`id` omitted) or edit form. */
function PriorityForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [rank, setRank] = createSignal('')
	const [color, setColor] = createSignal(DEFAULT_PRIORITY_COLOR)
	const [hex, setHex] = createSignal(DEFAULT_PRIORITY_COLOR)
	const [description, setDescription] = createSignal('')

	function applyColor(value: string): void {
		setColor(value)
		setHex(value)
	}

	/** Accepts `#rrggbb`, `rrggbb`, `#rgb` and `rgb`; anything else leaves the color unchanged. */
	function typeHex(value: string): void {
		setHex(value)
		const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
		if (!m) {
			return
		}
		const digits = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
		setColor(`#${digits.toLowerCase()}`)
	}

	const form = useEntityForm({
		id: props.id,
		load: fetch_priority,
		fill: (row: PriorityRow) => {
			setName(row.name)
			setRank(String(row.rank))
			applyColor(row.color)
			setDescription(row.description ?? '')
		},
	})
	const prefix = form.editing ? 'priority-edit' : 'priority'
	const backTo = useFormReturnRoute('/priorities', props.id)

	function reset(): void {
		setName('')
		setRank('')
		applyColor(DEFAULT_PRIORITY_COLOR)
		setDescription('')
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		const rankValue = Number(rank())
		await submit_form({
			form,
			name: name(),
			validate: () =>
				Number.isInteger(rankValue) && rankValue >= 1 && rankValue <= 99
					? null
					: t('priority.rankInvalid'),
			save: ({ name: trimmed }: FormValues) =>
				id === undefined
					? create_priority({
							name: trimmed,
							rank: rankValue,
							color: color(),
							description: text(description()),
						})
					: update_priority(id, {
							name: trimmed,
							rank: rankValue,
							color: color(),
							description: text(description()) ?? null,
						}),
			navigateTo: backTo(),
			onSuccess: is_add_another_submit(e) ? reset : undefined,
		})
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('priority.editTitle') : t('priority.addTitle')}
			name={form.record()?.name}
			loadingText={t('priority.loadingOne')}
			cancelTo={backTo()}
			onSubmit={handleSubmit}
		>
			<NameField
				id={`${prefix}-name`}
				placeholder={t('priority.namePlaceholder')}
				value={name()}
				onInput={setName}
				autofocus={!form.editing}
			/>
			<TextField
				id={`${prefix}-rank`}
				label={t('priority.rank')}
				type="number"
				min={1}
				max={99}
				step={1}
				required
				value={rank()}
				onInput={setRank}
				hint={<Hint>{t('priority.rankHint')}</Hint>}
			/>
			<Field label={t('priority.color')} for={`${prefix}-color`}>
				<div class="color-field">
					<input
						id={`${prefix}-color`}
						type="text"
						class="color-hex"
						aria-label={t('priority.colorHex')}
						placeholder="#rrggbb"
						maxLength={7}
						spellcheck={false}
						value={hex()}
						onInput={(e: InputEventAndTarget) => typeHex(e.currentTarget.value)}
						onBlur={() => setHex(color())}
					/>
					<input
						type="color"
						aria-label={t('priority.color')}
						value={color()}
						onInput={(e: InputEventAndTarget) => applyColor(e.currentTarget.value)}
					/>
					<PriorityPill
						name={name().trim() || t('priority.namePlaceholder')}
						color={color()}
					/>
				</div>
			</Field>
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>
		</FormPage>
	)
}

/** /priorities/add — priority create form. */
export function PriorityAddPage(): JSX.Element {
	return <PriorityForm />
}

/** /priorities/:id/edit — priority edit form. Saves back to the list when opened from it. */
export function PriorityEditPage(props: { id: number }): JSX.Element {
	return <PriorityForm id={props.id} />
}
