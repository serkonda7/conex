/**
 * Changelog API wrapper: read-only history of inventory changes, newest
 * first. Tenant-scoped users get their own tenant's changes only.
 */
import type { Result } from 'better-result'
import type { ChangelogListQuery, ObjectChangeJson, Page } from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type { ObjectChangeJson }

export async function fetch_changelog(
	filters?: Partial<ChangelogListQuery>,
): Promise<Result<Page<ObjectChangeJson>, Error>> {
	return getPage<ObjectChangeJson>(
		client.changelog.$get({
			query: to_query({
				...paging(filters),
				action: filters?.action,
				object_type: filters?.object_type,
				tenant: filters?.tenant,
				tenant_group: filters?.tenant_group,
			}),
		}),
		failed.list('noun.change'),
	)
}

export async function fetch_object_change(id: number): Promise<Result<ObjectChangeJson, Error>> {
	const res = await client.changelog[':id'].$get(by_id(id))
	return to_result<ObjectChangeJson>(res, failed.load('noun.change'))
}
