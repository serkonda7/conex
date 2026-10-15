import { createSignal, type JSX } from 'solid-js'
import {
	create_priority,
	fetch_priority,
	type PriorityRow,
	update_priority,
} from '../../api/service_catalog'
import {
	DescriptionField,
	FormPage,
	Hint,
	NameField,
	TextAreaField,
	TextField,
} from '../../components/form'
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
	const [description, setDescription] = createSignal('')
	const [definition, setDefinition] = createSignal('')
	const form = useEntityForm({
		id: props.id,
		load: fetch_priority,
		fill: (row: PriorityRow) => {
			setName(row.name)
			setRank(String(row.rank))
			setDescription(row.description ?? '')
			setDefinition(row.definition ?? '')
		},
	})
	const prefix = form.editing ? 'priority-edit' : 'priority'
	const backTo = useFormReturnRoute('/priorities', props.id)

	function reset(): void {
		setName('')
		setRank('')
		setDescription('')
		setDefinition('')
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
							description: text(description()),
							definition: text(definition()),
						})
					: update_priority(id, {
							name: trimmed,
							rank: rankValue,
							description: text(description()) ?? null,
							definition: text(definition()) ?? null,
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
			<DescriptionField
				id={`${prefix}-description`}
				value={description()}
				onInput={setDescription}
			/>
			<TextAreaField
				id={`${prefix}-definition`}
				label={t('priority.definition')}
				placeholder={t('priority.definitionPlaceholder')}
				rows={6}
				maxLength={4000}
				value={definition()}
				onInput={setDefinition}
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
