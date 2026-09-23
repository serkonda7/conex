/**
 * Transfer API wrappers: CSV transfer and NetBox YAML device-type import.
 * CSV download uses a raw fetch (binary blob) and CSV upload posts the
 * file text as `{ csv }` JSON.
 */
import { Result } from 'better-result'
import type { ImportResponse } from 'shared/src/types'
import { post_json } from './api'
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
	return post_json<ImportResponse>(`/api/${kind}/import`, { csv }, `Failed to import ${kind}`)
}

/** Uploads a NetBox device-type YAML document or collection. */
export async function upload_yaml(yaml: string): Promise<Result<ImportResponse, Error>> {
	return post_json<ImportResponse>(
		'/api/device-types/import',
		{ yaml },
		'Failed to import device types',
	)
}
