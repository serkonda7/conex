import { IconExternalLink } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { DISPLAY_PORT_KINDS, GENERAL_PORT_KINDS } from 'shared/src/schemas'
import type { ImportRowResult } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, For, Show } from 'solid-js'
import { create_manufacturer, update_device_type } from '../../api/templates'
import { upload_yaml } from '../../api/transfer'
import { DataTable } from '../../components/data_table'
import { Field } from '../../components/form'
import { t } from '../../i18n'
import { navigate } from '../../lib/router'

const SAMPLE_YAML = `manufacturer: Acme
model: Example Switch 48
u_height: 1
is_full_depth: true
interfaces:
  - name: GigabitEthernet
    type: 1000base-t
`

/** Field-options description for a NetBox port list (`interfaces`, …). */
/** Ports field help; `types` (required type from a fixed list) replaces `defaultType`. */
function PortsDescription(props: {
	optional: string[]
	defaultType?: string
	types?: readonly string[]
	/** With `defaultType`: types kept as-is, others fall back to the default. */
	knownTypes?: readonly string[]
}): JSX.Element {
	return (
		<>
			{t('import.fieldPortsPrefix')} <code>name</code>
			{t('import.fieldPortsOptional')}{' '}
			<For each={props.optional}>
				{(field: string, i: () => number): JSX.Element => (
					<>
						<Show when={i() > 0}>
							{i() === props.optional.length - 1
								? ` ${t('import.fieldPortsAnd')} `
								: ', '}
						</Show>
						<code>{field}</code>
					</>
				)}
			</For>
			.{' '}
			{props.types
				? t('import.fieldPortsTypes', { types: props.types.join(', ') })
				: props.knownTypes
					? t('import.fieldPortsKnownTypes', {
							types: props.knownTypes.join(', '),
							type: props.defaultType ?? '',
						})
					: t('import.fieldPortsDefault', { type: props.defaultType ?? '' })}
		</>
	)
}

/**
 * /device-types/import — NetBox YAML import for device types (no manual add form).
 * Posts the file text as `{ yaml }` JSON. The import is all-or-nothing: if any
 * document fails, nothing is created and the response reports per-row errors
 * below. The pasted text is kept on failure; rows failing on an unknown
 * manufacturer offer to create it, rows clashing with an existing device type
 * offer to rename the existing one.
 */
export function DeviceTypeImportPage(): JSX.Element {
	const [yamlText, setYamlText] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [importing, setImporting] = createSignal(false)
	const [results, setResults] = createSignal<ImportRowResult[] | null>(null)
	const [created, setCreated] = createSignal(0)
	const [failed, setFailed] = createSignal(0)
	const [createdManufacturers, setCreatedManufacturers] = createSignal<string[]>([])
	const [creatingManufacturer, setCreatingManufacturer] = createSignal<string | null>(null)
	/** Existing device type ids renamed since the last import, with their new model. */
	const [renamedTypes, setRenamedTypes] = createSignal<Record<number, string>>({})
	const [renameDraft, setRenameDraft] = createSignal<{ id: number; model: string } | null>(null)
	const [renamingType, setRenamingType] = createSignal(false)

	async function handleCreateManufacturer(name: string): Promise<void> {
		setError(null)
		setCreatingManufacturer(name)
		const res = await create_manufacturer({ name })
		setCreatingManufacturer(null)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setCreatedManufacturers((prev) => [...prev, name])
	}

	async function handleRenameType(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const draft = renameDraft()
		if (draft === null) {
			return
		}
		setError(null)
		setRenamingType(true)
		const res = await update_device_type(draft.id, { model: draft.model })
		setRenamingType(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setRenamedTypes((prev) => ({ ...prev, [draft.id]: res.value.model }))
		setRenameDraft(null)
	}

	function RenameExisting(props: { id: number; model: string }): JSX.Element {
		return (
			<Show
				when={renamedTypes()[props.id] === undefined}
				fallback={t('import.deviceTypeRenamed', {
					name: props.model,
					newName: renamedTypes()[props.id] ?? '',
				})}
			>
				<Show
					when={renameDraft()?.id === props.id}
					fallback={
						<button
							type="button"
							disabled={renamingType()}
							onClick={() => setRenameDraft({ id: props.id, model: props.model })}
						>
							{t('import.renameExisting')}
						</button>
					}
				>
					<form class="import-rename" onSubmit={handleRenameType}>
						<input
							type="text"
							aria-label={t('import.newName')}
							value={renameDraft()?.model ?? ''}
							onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) =>
								setRenameDraft({ id: props.id, model: e.currentTarget.value })
							}
							required
						/>
						<button
							type="submit"
							disabled={
								renamingType() ||
								!renameDraft()?.model.trim() ||
								renameDraft()?.model.trim() === props.model
							}
						>
							{t('import.rename')}
						</button>
						<button
							type="button"
							disabled={renamingType()}
							onClick={() => setRenameDraft(null)}
						>
							{t('common.cancel')}
						</button>
					</form>
				</Show>
			</Show>
		)
	}

	async function handleImport(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		setResults(null)
		setCreatedManufacturers([])
		setRenamedTypes({})
		setRenameDraft(null)
		if (!yamlText().trim()) {
			setError(t('import.pasteFirst'))
			return
		}
		setImporting(true)
		const res = await upload_yaml(yamlText())
		setImporting(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setCreated(res.value.created)
		setFailed(res.value.failed)
		setResults(res.value.rows)
		if (res.value.failed === 0) {
			setYamlText('')
		}
	}

	return (
		<div class="form-page device-type-import-page">
			<h2>{t('import.title')}</h2>
			<p class="page-subtitle">
				{t('import.libraryIntro')}{' '}
				<a
					href="https://github.com/serkonda7/conex-device-types"
					target="_blank"
					rel="noreferrer"
				>
					{t('import.libraryLink')} <IconExternalLink size={14} aria-hidden="true" />
				</a>
			</p>
			<form class="form-stacked" onSubmit={handleImport}>
				<Field label={t('import.data')} for="device-type-import-text">
					<textarea
						id="device-type-import-text"
						class="import-data"
						rows={10}
						placeholder={SAMPLE_YAML}
						value={yamlText()}
						onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) =>
							setYamlText(e.currentTarget.value)
						}
					/>
				</Field>
				<Show when={error()}>
					<div class="app-inline-error" role="alert">
						{error()}
					</div>
				</Show>
				<div class="form-actions">
					<button
						type="button"
						onClick={() => navigate('/device-types', { refresh: false, back: true })}
						disabled={importing()}
					>
						{t('common.cancel')}
					</button>
					<button type="submit" disabled={importing()}>
						{importing() ? t('import.importing') : t('import.import')}
					</button>
				</div>
			</form>

			<Show when={results() !== null}>
				<h3>{t('import.result', { created: created(), failed: failed() })}</h3>
				<Show when={failed() > 0}>
					<p class="app-inline-error" role="alert">
						{t('import.rolledBack')}
					</p>
				</Show>
				<DataTable
					rows={() => results() ?? []}
					getRowId={(r: ImportRowResult): number => r.row}
					columns={[
						{
							key: 'row',
							label: t('import.row'),
							getValue: (r: ImportRowResult): number => r.row,
						},
						{
							key: 'status',
							label: t('common.status'),
							getValue: (r: ImportRowResult): JSX.Element => {
								if (r.ok) {
									return (
										<span class="badge badge-active">
											{t('import.created')}
										</span>
									)
								}
								// Valid rows rolled back because another row failed.
								if (r.error === null) {
									return (
										<span class="badge badge-planned">
											{t('import.notImported')}
										</span>
									)
								}
								return (
									<span class="badge badge-decommissioned">
										{t('import.failed')}
									</span>
								)
							},
						},
						{
							key: 'id',
							label: t('import.id'),
							getValue: (r: ImportRowResult): string =>
								r.id === null ? '—' : String(r.id),
						},
						{
							key: 'error',
							label: t('import.error'),
							getValue: (r: ImportRowResult): JSX.Element => {
								const existing = r.existing_device_type
								if (existing !== undefined) {
									return (
										<span>
											{r.error} <RenameExisting {...existing} />
										</span>
									)
								}
								const name = r.unknown_manufacturer
								if (name === undefined) {
									return r.error ?? '—'
								}
								return (
									<span>
										{r.error}{' '}
										<Show
											when={!createdManufacturers().includes(name)}
											fallback={t('import.manufacturerCreated', { name })}
										>
											<button
												type="button"
												disabled={creatingManufacturer() !== null}
												onClick={() => void handleCreateManufacturer(name)}
											>
												{t('import.createManufacturer', { name })}
											</button>
										</Show>
									</span>
								)
							},
						},
					]}
					emptyContent={<p class="empty">{t('import.noRows')}</p>}
				/>
			</Show>
			<section class="import-field-options" aria-labelledby="device-type-import-fields">
				<h3 id="device-type-import-fields">{t('import.fieldOptions')}</h3>
				<p class="field-hint">{t('import.fieldOptionsHint')}</p>
				<table class="import-field-options-table">
					<thead>
						<tr>
							<th scope="col">{t('import.field')}</th>
							<th scope="col">{t('import.required')}</th>
							<th scope="col">{t('common.description')}</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>manufacturer</td>
							<td>{t('common.yes')}</td>
							<td>{t('import.fieldManufacturer')}</td>
						</tr>
						<tr>
							<td>model</td>
							<td>{t('common.yes')}</td>
							<td>{t('import.fieldModel')}</td>
						</tr>
						<tr>
							<td>u_height</td>
							<td>—</td>
							<td>{t('import.fieldUHeight')}</td>
						</tr>
						<tr>
							<td>is_full_depth</td>
							<td>—</td>
							<td>{t('import.fieldFullDepth')}</td>
						</tr>
						<tr>
							<td>description</td>
							<td>—</td>
							<td>{t('import.fieldDescription')}</td>
						</tr>
						<tr>
							<td>comments</td>
							<td>—</td>
							<td>{t('import.fieldComments')}</td>
						</tr>
						<tr>
							<td>interfaces</td>
							<td>—</td>
							<td>
								<PortsDescription
									optional={['type', 'label', 'description']}
									defaultType="ethernet"
								/>
							</td>
						</tr>
						<tr>
							<td>ports</td>
							<td>—</td>
							<td>
								<PortsDescription
									optional={['type', 'description']}
									defaultType="port"
									knownTypes={GENERAL_PORT_KINDS}
								/>{' '}
								{t('import.fieldAlias', { alias: 'console-ports' })}
							</td>
						</tr>
						<tr>
							<td>power-ports</td>
							<td>—</td>
							<td>
								<PortsDescription
									optional={['type', 'description']}
									defaultType="power"
								/>
							</td>
						</tr>
						<tr>
							<td>power-outlets</td>
							<td>—</td>
							<td>
								<PortsDescription
									optional={['type', 'description']}
									defaultType="power-outlet"
								/>
							</td>
						</tr>
						<tr>
							<td>display-ports</td>
							<td>—</td>
							<td>
								<PortsDescription
									optional={['description']}
									types={DISPLAY_PORT_KINDS}
								/>
							</td>
						</tr>
					</tbody>
				</table>
			</section>
		</div>
	)
}
