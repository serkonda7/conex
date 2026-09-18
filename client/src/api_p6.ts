/**
 * P6 API wrappers: global search and CSV import/export.
 * Search goes over the typed hono RPC client; CSV download uses a raw
 * fetch (binary blob) and CSV upload posts the file text as `{ csv }` JSON.
 */
import { Result } from 'better-result'
import type { ImportResponse } from 'shared/src/schemas'
import { client, to_result } from './api'
import { read_api_error } from './util/api_error'

export type { ImportResponse }

export interface SearchGroup<T> {
	items: T[]
	total: number
}

export interface SearchTenant {
	id: string
	name: string
	slug: string
}

export interface SearchSite {
	id: string
	name: string
	slug: string
}

export interface SearchRack {
	id: string
	name: string
	slug: string
}

export interface SearchDevice {
	id: string
	name: string
	asset_tag: string | null
}

export interface SearchCable {
	id: string
	label: string | null
	kind: string | null
}

export interface GlobalSearchResponse {
	q: string
	tenants: SearchGroup<SearchTenant>
	sites: SearchGroup<SearchSite>
	racks: SearchGroup<SearchRack>
	devices: SearchGroup<SearchDevice>
	cables: SearchGroup<SearchCable>
}

export async function fetch_search(q: string): Promise<Result<GlobalSearchResponse, Error>> {
	const res = await client.search.$get({ query: { q } })
	return to_result<GlobalSearchResponse>(res, 'Failed to search')
}

/** Downloads a CSV export (`devices` or `cables`) as a browser file save. */
export async function download_csv(kind: 'devices' | 'cables'): Promise<Result<void, Error>> {
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

/** Uploads CSV text to the `devices`/`cables` import endpoint. */
export async function upload_csv(
	kind: 'devices' | 'cables',
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
