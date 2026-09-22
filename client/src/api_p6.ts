/**
 * P6 API wrappers: CSV import/export.
 * CSV download uses a raw fetch (binary blob) and CSV upload posts the
 * file text as `{ csv }` JSON.
 */
import { Result } from 'better-result'
import type { ImportResponse } from 'shared/src/schemas'
import { read_api_error } from './util/api_error'

export type { ImportResponse }

/** Downloads a CSV export (`devices`, `cables`, or `device-types`) as a browser file save. */
export async function download_csv(
	kind: 'devices' | 'cables' | 'device-types',
): Promise<Result<void, Error>> {
	try {
		const res = await fetch(`/api/${kind}/export`)
		if (!res.ok) {
			return Result.err(new Error(await read_api_error(res, `Failed to export ${kind}`)))
		}
		const blob = await res.blob()
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = `${kind}.csv`
		document.body.appendChild(link)
		link.click()
		link.remove()
		URL.revokeObjectURL(url)
		return Result.ok(undefined)
	} catch {
		return Result.err(new Error(`Failed to export ${kind}`))
	}
}

/** Uploads CSV text to the `devices`/`cables`/`device-types` import endpoint. */
export async function upload_csv(
	kind: 'devices' | 'cables' | 'device-types',
	csv: string,
): Promise<Result<ImportResponse, Error>> {
	try {
		const res = await fetch(`/api/${kind}/import`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ csv }),
		})
		if (!res.ok) {
			return Result.err(new Error(await read_api_error(res, `Failed to import ${kind}`)))
		}
		return Result.ok((await res.json()) as ImportResponse)
	} catch {
		return Result.err(new Error(`Failed to import ${kind}`))
	}
}
