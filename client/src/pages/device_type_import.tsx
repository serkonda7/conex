import { DataTable } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { ImportRowResult } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { upload_yaml } from '../api_transfer'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to, { refresh: false })
}

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
			setError('Paste NetBox YAML first.')
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
				<a href="/device-types" onClick={(e: MouseEvent): void => go(e, '/device-types')}>
					← Device types
				</a>
			</p>
			<h2>Import device types</h2>
			<p class="page-subtitle">
				For prebuilt definitions see{' '}
				<a
					href="https://github.com/netbox-community/devicetype-library"
					target="_blank"
					rel="noreferrer"
				>
					NetBox device-type library
				</a>
			</p>
			<form class="form-stacked" onSubmit={handleImport}>
				<div class="field">
					<label for="device-type-import-text">Data</label>
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
					<h3 id="device-type-import-fields">Field options</h3>
					<p class="field-hint">
						Use these NetBox YAML fields in each device-type definition. Required fields
						are marked.
					</p>
					<table class="import-field-options-table">
						<thead>
							<tr>
								<th scope="col">Field</th>
								<th scope="col">Required</th>
								<th scope="col">Description</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>manufacturer</td>
								<td>Yes</td>
								<td>
									Manufacturer name or slug; device type model identifies the
									type.
								</td>
							</tr>
							<tr>
								<td>model</td>
								<td>Yes</td>
								<td>Device model name.</td>
							</tr>
							<tr>
								<td>u_height</td>
								<td>—</td>
								<td>Rack height from 0 to 60; defaults to 1.</td>
							</tr>
							<tr>
								<td>is_full_depth</td>
								<td>—</td>
								<td>Full-depth device (true/false, defaults to true).</td>
							</tr>
							<tr>
								<td>description</td>
								<td>—</td>
								<td>Optional short device-type summary.</td>
							</tr>
							<tr>
								<td>comments</td>
								<td>—</td>
								<td>Optional longer device-type notes.</td>
							</tr>
							<tr>
								<td>interfaces</td>
								<td>—</td>
								<td>
									List of ports with <code>name</code>, optional <code>type</code>{' '}
									and <code>label</code>.
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
						Cancel
					</button>
					<button type="submit" disabled={importing()}>
						{importing() ? 'Importing…' : 'Import'}
					</button>
				</div>
			</form>

			<Show when={results() !== null}>
				<h3>
					Result: {created()} created, {failed()} failed
				</h3>
				<DataTable
					rows={() => results() ?? []}
					getRowId={(r: ImportRowResult): number => r.row}
					showColumnCustomizer
					columns={[
						{
							key: 'row',
							label: 'Row',
							getValue: (r: ImportRowResult): number => r.row,
						},
						{
							key: 'status',
							label: 'Status',
							getValue: (r: ImportRowResult): JSX.Element => (
								<span class={`badge badge-${r.ok ? 'active' : 'decommissioned'}`}>
									{r.ok ? 'created' : 'failed'}
								</span>
							),
						},
						{
							key: 'id',
							label: 'Id',
							getValue: (r: ImportRowResult): string =>
								r.id === null ? '—' : String(r.id),
						},
						{
							key: 'error',
							label: 'Error',
							getValue: (r: ImportRowResult): string => r.error ?? '—',
						},
					]}
					emptyContent={<p class="empty">No rows processed.</p>}
				/>
			</Show>
		</div>
	)
}
