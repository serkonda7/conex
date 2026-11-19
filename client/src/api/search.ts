/**
 * Global search API wrapper: grouped name/asset-tag hits across the
 * inventory, for the command palette.
 */
import type { Result } from 'better-result'
import type { GlobalSearchResponse } from 'server/src/db/search'
import { t } from '../i18n'
import { client, to_result } from './client'

export type { GlobalSearchResponse }

export async function search_objects(q: string): Promise<Result<GlobalSearchResponse, Error>> {
	const res = await client.search.$get({ query: { q } })
	return to_result<GlobalSearchResponse>(res, t('api.searchFailed'))
}
