import { IconExternalLink } from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import type { ImportRowResult } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { upload_yaml } from '../api_transfer'
import { DataTable } from '../components/data_table'
import { t, tp } from '../i18n'
import { goTo, navigate } from '../router'

const SAMPLE_YAML = `manufacturer: Acme
model: Example Switch 48
u_height: 1
is_full_depth: true
interfaces:
  - name: GigabitEthernet
    type: 1000base-t
`

/**
 * /device-types/import — NetBox YAML import for device types (no manual add form).
 * Posts the file text as `{ yaml }` JSON; one bad document fails only itself and
 * the response reports per-row errors below.
 */
export function DeviceTypeImportPage(): JSX.Element {
	const [yamlText, setYamlText] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [importing, setImporting] = createSignal(false)
	const [results, setResults] = createSignal<ImportRowResult[] | null>(null)
	const [created, setCreated] = createSignal(0)
	const [failed, setFailed] = createSignal(0)

	async function handleImport(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		setResults(null)
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
		setYamlText('')
	}

	return (
		<div class="form-page device-type-import-page">
			<p>
				<a
					href="/device-types"
					onClick={(e: MouseEvent): void => goTo(e, '/device-types', { refresh: false })}
				>
					← {tp('entity.deviceType', 2)}
				</a>
			</p>
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
									{t('import.fieldInterfacesPrefix')} <code>name</code>
									{t('import.fieldInterfacesOptional')} <code>type</code>{' '}
									{t('import.fieldInterfacesAnd')} <code>label</code>.
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
				<DataTable
					rows={() => results() ?? []}
					getRowId={(r: ImportRowResult): number => r.row}
					showColumnCustomizer
					columns={[
						{
							key: 'row',
							label: t('import.row'),
							getValue: (r: ImportRowResult): number => r.row,
						},
						{
							key: 'status',
							label: t('common.status'),
							getValue: (r: ImportRowResult): JSX.Element => (
								<span class={`badge badge-${r.ok ? 'active' : 'decommissioned'}`}>
									{r.ok ? t('import.created') : t('import.failed')}
								</span>
							),
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
							getValue: (r: ImportRowResult): string => r.error ?? '—',
						},
					]}
					emptyContent={<p class="empty">{t('import.noRows')}</p>}
				/>
			</Show>
		</div>
	)
}
