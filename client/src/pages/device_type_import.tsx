import { DataTable } from '@serkonda7/solid-components'
import { Result } from 'better-result'
import type { ImportRowResult } from 'shared/src/schemas'
import type { JSX } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { download_csv, upload_csv } from '../api_p6'
import { navigate } from '../router'

function go(e: MouseEvent, to: string): void {
	e.preventDefault()
	navigate(to)
}

const SAMPLE_CSV = `manufacturer_slug,model,slug,u_height,form_factor,width,description
acme,Example Switch 48,example-switch-48,1,,,48-port switch
`

/**
 * /device-types/import — CSV import for device types (no manual add form).
 * Posts the file text as `{ csv }` JSON; one bad row fails only itself and
 * the response reports per-row errors below.
 */
export function DeviceTypeImportPage(): JSX.Element {
	const [csvText, setCsvText] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [importing, setImporting] = createSignal(false)
	const [results, setResults] = createSignal<ImportRowResult[] | null>(null)
	const [created, setCreated] = createSignal(0)
	const [failed, setFailed] = createSignal(0)

	async function handleFile(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
		const file = e.currentTarget.files?.[0]
		if (!file) {
			return
		}
		setCsvText(await file.text())
	}

	function useSample(): void {
		setCsvText(SAMPLE_CSV)
	}

	async function handleDownload(e: MouseEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		const res = await download_csv('device-types')
		if (Result.isError(res)) {
			setError(res.error.message)
		}
	}

	async function handleImport(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		setError(null)
		setResults(null)
		if (!csvText().trim()) {
			setError('Paste CSV text or pick a file first.')
			return
		}
		setImporting(true)
		const res = await upload_csv('device-types', csvText())
		setImporting(false)
		if (Result.isError(res)) {
			setError(res.error.message)
			return
		}
		setCreated(res.value.created)
		setFailed(res.value.failed)
		setResults(res.value.rows)
	}

	return (
		<div class="form-page">
			<p>
				<a href="/device-types" onClick={(e: MouseEvent): void => go(e, '/device-types')}>
					← Device types
				</a>
			</p>
			<h2>Import device types</h2>
			<p class="page-subtitle">
				CSV columns:{' '}
				<code>manufacturer_slug,model,slug,u_height,form_factor,width,description</code>.
				Only <code>manufacturer_slug</code>, <code>model</code> and <code>slug</code> are
				required; <code>u_height</code> defaults to 1. Rows with an unknown manufacturer
				slug fail individually.{' '}
				<a href="/api/device-types/export" onClick={handleDownload}>
					Download current export
				</a>{' '}
				for the exact format, or start from the sample below.
			</p>
			<form class="form-stacked" onSubmit={handleImport}>
				<div class="field">
					<label for="device-type-import-file">CSV file</label>
					<input
						id="device-type-import-file"
						type="file"
						accept=".csv,text/csv"
						onChange={handleFile}
					/>
				</div>
				<div class="field">
					<label for="device-type-import-text">CSV text</label>
					<textarea
						id="device-type-import-text"
						rows={10}
						placeholder={SAMPLE_CSV}
						value={csvText()}
						onInput={(e: InputEvent & { currentTarget: HTMLTextAreaElement }) =>
							setCsvText(e.currentTarget.value)
						}
					/>
				</div>
				<Show when={error()}>
					<div class="app-inline-error" role="alert">
						{error()}
					</div>
				</Show>
				<div class="form-actions">
					<button type="button" onClick={useSample} disabled={importing()}>
						Use sample
					</button>
					<button type="submit" disabled={importing()}>
						{importing() ? 'Importing…' : 'Import'}
					</button>
					<button
						type="button"
						onClick={() => navigate('/device-types')}
						disabled={importing()}
					>
						Cancel
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
