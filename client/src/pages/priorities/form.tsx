import { ColorInput } from '@serkonda7/solid-components'
import { DEFAULT_PRIORITY_COLOR } from 'shared/src/schemas'
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
import { type FormValues, submit_entity_form, text, useEntityForm } from '../../lib/form'
import { queryParam, useFormReturnRoute } from '../../lib/router'

/** Priority create (`id` omitted) or edit form. */
function PriorityForm(props: { id?: number }): JSX.Element {
	// `?name=` comes from the search typed into an opener's dropdown.
	const [name, setName] = createSignal(queryParam('name'))
	const [rank, setRank] = createSignal('')
	const [color, setColor] = createSignal(DEFAULT_PRIORITY_COLOR)
	const [description, setDescription] = createSignal('')

	const form = useEntityForm({
		id: props.id,
		load: fetch_priority,
		fill: (row: PriorityRow) => {
			setName(row.name)
			setRank(String(row.rank))
			setColor(row.color)
			setDescription(row.description ?? '')
		},
	})
	const prefix = form.editing ? 'priority-edit' : 'priority'
	const backTo = useFormReturnRoute('/priorities', props.id)

	function reset(): void {
		setName('')
		setRank('')
		setColor(DEFAULT_PRIORITY_COLOR)
		setDescription('')
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		const rankValue = Number(rank())
		await submit_entity_form(e, {
			form,
			name: name(),
			validate: () =>
				Number.isInteger(rankValue) && rankValue >= 1 && rankValue <= 99
					? null
					: t('priority.rankInvalid'),
			body: (values: FormValues) => ({
				name: values.name,
				rank: rankValue,
				color: color(),
				description: text(description()),
			}),
			create: create_priority,
			update: update_priority,
			navigateTo: backTo(),
			reset,
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
			<Field label={t('priority.color')}>
				<div class="color-field">
					<ColorInput
						value={color()}
						onInput={setColor}
						ariaLabel={t('priority.colorHex')}
						pickerLabel={t('priority.color')}
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
