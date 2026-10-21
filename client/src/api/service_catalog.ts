/**
 * Service catalog API wrappers: typed priorities/service-levels/managed-bundles
 * calls over the hono RPC client. Errors surface as
 * `Result.err` with the server's `{ error }` message.
 */
import type { Result } from 'better-result'
import type {
	ManagedBundleListRow,
	ManagedBundleRow,
	PriorityListRow,
	PriorityRow,
	ServiceLevelDetail,
	ServiceLevelListRow,
} from 'server/src/db/service_catalog'
import type {
	ManagedBundleCreate,
	ManagedBundleListQuery,
	ManagedBundleUpdate,
	Page,
	PriorityCreate,
	PriorityListQuery,
	PriorityUpdate,
	ServiceLevelCreate,
	ServiceLevelListQuery,
	ServiceLevelUpdate,
} from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type {
	ManagedBundleListRow,
	ManagedBundleRow,
	PriorityListRow,
	PriorityRow,
	ServiceLevelDetail,
	ServiceLevelListRow,
}

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

export type PrioritySort = PriorityListQuery['sort']

export async function fetch_priorities(
	filters?: Partial<PriorityListQuery>,
): Promise<Result<Page<PriorityListRow>, Error>> {
	return getPage<PriorityListRow>(
		client.priorities.$get({
			query: to_query({
				...paging(filters),
				sort: filters?.sort ?? 'rank',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.priority'),
	)
}

export async function fetch_priority(id: number): Promise<Result<PriorityRow, Error>> {
	const res = await client.priorities[':id'].$get(by_id(id))
	return to_result<PriorityRow>(res, failed.load('noun.priority'))
}

export async function create_priority(input: PriorityCreate): Promise<Result<PriorityRow, Error>> {
	const res = await client.priorities.$post({ json: input })
	return to_result<PriorityRow>(res, failed.create('noun.priority'))
}

export async function update_priority(
	id: number,
	patch: PriorityUpdate,
): Promise<Result<PriorityRow, Error>> {
	const res = await client.priorities[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<PriorityRow>(res, failed.update('noun.priority'))
}

export async function delete_priority(id: number): Promise<Result<unknown, Error>> {
	const res = await client.priorities[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.priority'))
}

// ---------------------------------------------------------------------------
// Service levels
// ---------------------------------------------------------------------------

export type ServiceLevelSort = ServiceLevelListQuery['sort']

export async function fetch_service_levels(
	filters?: Partial<ServiceLevelListQuery>,
): Promise<Result<Page<ServiceLevelListRow>, Error>> {
	return getPage<ServiceLevelListRow>(
		client['service-levels'].$get({
			query: to_query({
				...paging(filters),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.serviceLevel'),
	)
}

export async function fetch_service_level(id: number): Promise<Result<ServiceLevelDetail, Error>> {
	const res = await client['service-levels'][':id'].$get(by_id(id))
	return to_result<ServiceLevelDetail>(res, failed.load('noun.serviceLevel'))
}

export async function create_service_level(
	input: ServiceLevelCreate,
): Promise<Result<ServiceLevelDetail, Error>> {
	const res = await client['service-levels'].$post({ json: input })
	return to_result<ServiceLevelDetail>(res, failed.create('noun.serviceLevel'))
}

export async function update_service_level(
	id: number,
	patch: ServiceLevelUpdate,
): Promise<Result<ServiceLevelDetail, Error>> {
	const res = await client['service-levels'][':id'].$patch({ ...by_id(id), json: patch })
	return to_result<ServiceLevelDetail>(res, failed.update('noun.serviceLevel'))
}

export async function delete_service_level(id: number): Promise<Result<unknown, Error>> {
	const res = await client['service-levels'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.serviceLevel'))
}

// ---------------------------------------------------------------------------
// Managed bundles
// ---------------------------------------------------------------------------

export type ManagedBundleSort = ManagedBundleListQuery['sort']

export async function fetch_managed_bundles(
	filters?: Partial<ManagedBundleListQuery>,
): Promise<Result<Page<ManagedBundleListRow>, Error>> {
	return getPage<ManagedBundleListRow>(
		client['managed-bundles'].$get({
			query: to_query({
				...paging(filters),
				sort: filters?.sort ?? 'name',
				order: filters?.order ?? 'asc',
			}),
		}),
		failed.list('noun.managedBundle'),
	)
}

export async function fetch_managed_bundle(id: number): Promise<Result<ManagedBundleRow, Error>> {
	const res = await client['managed-bundles'][':id'].$get(by_id(id))
	return to_result<ManagedBundleRow>(res, failed.load('noun.managedBundle'))
}

export async function create_managed_bundle(
	input: ManagedBundleCreate,
): Promise<Result<ManagedBundleRow, Error>> {
	const res = await client['managed-bundles'].$post({ json: input })
	return to_result<ManagedBundleRow>(res, failed.create('noun.managedBundle'))
}

export async function update_managed_bundle(
	id: number,
	patch: ManagedBundleUpdate,
): Promise<Result<ManagedBundleRow, Error>> {
	const res = await client['managed-bundles'][':id'].$patch({ ...by_id(id), json: patch })
	return to_result<ManagedBundleRow>(res, failed.update('noun.managedBundle'))
}

export async function delete_managed_bundle(id: number): Promise<Result<unknown, Error>> {
	const res = await client['managed-bundles'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.managedBundle'))
}
