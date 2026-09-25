import { IconExternalLink } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { ImportRowResult } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, For, Show } from 'solid-js'
import { create_manufacturer } from '../api_templates'
import { upload_yaml } from '../api_transfer'
import { DataTable } from '../components/data_table'
import { t } from '../i18n'
import { navigate } from '../router'

const SAMPLE_YAML = `manufacturer: Acme
model: Example Switch 48
u_height: 1
is_full_depth: true
interfaces:
  - name: GigabitEthernet
    type: 1000base-t
`

/** Field-options description for a NetBox port list (`interfaces`, …). */
function PortsDescription(props: { optional: string[]; defaultType: string }): JSX.Element {
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
			. {t('import.fieldPortsDefault', { type: props.defaultType })}
		</>
	)
}

/**
 * /device-types/import — NetBox YAML import for device types (no manual add form).
 * Posts the file text as `{ yaml }` JSON. The import is all-or-nothing: if any
 * document fails, nothing is created and the response reports per-row errors
 * below. The pasted text is kept on failure; rows failing on an unknown
 * manufacturer offer to create it.
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

	async function handleCreateManufacturer(name: string): Promise<void> {
		setError(null)
		setCreatingManufacturer(name)
		const res = await create_manufacturer(name)
		setCreatingManufacturer(null)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setCreatedManufacturers((prev) => [...prev, name])
	}

	async function handleImport(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		setResults(null)
		setCreatedManufacturers([])
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
					href="https://github.com/netbox-community/devicetype-library"
					target="_blank"
					rel="noreferrer"
				>
					{t('import.libraryLink')} <IconExternalLink size={14} aria-hidden="true" />
				</a>
			</p>
			<form class="form-stacked" onSubmit={handleImport}>
				<div class="field">
					<label for="device-type-import-text">{t('import.data')}</label>
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
				</div>
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
								<td>console-ports</td>
								<td>—</td>
								<td>
									<PortsDescription
										optional={['type', 'description']}
										defaultType="console"
									/>
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
						</tbody>
					</table>
				</section>
				<Show when={error()}>
					<div class="app-inline-error" role="alert">
						{error()}
					</div>
				</Show>
				<div class="form-actions">
					<button
						type="button"
						onClick={() => navigate('/device-types', { refresh: false })}
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
		</div>
	)
}
