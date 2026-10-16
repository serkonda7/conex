import { Result } from 'better-result'
import { asc, eq } from 'drizzle-orm'
import type {
	PriorityCreate,
	PriorityUpdate,
	ServiceLevelCreate,
	ServiceLevelTarget,
	ServiceLevelTargetJson,
	ServiceLevelUpdate,
	ServiceWindow,
} from 'shared/src/schemas'
import { priorities, service_level_targets, service_levels } from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { ConflictError, DuplicateError, NotFoundError } from './errors'
import type { ListParams, Page } from './list'
import {
	countBy,
	exists,
	findById,
	insertedId,
	isPatchEmpty,
	isTaken,
	orderOf,
	pageRows,
	pickDefined,
	searchCondition,
	tryWrite,
} from './list'

// ---------------------------------------------------------------------------
// Service catalog (MSP operations): priorities and service levels (SLA). Shared catalog data (no tenant column): readable by every
// authenticated user, writable only by global editors/admins.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

export type PriorityRow = typeof priorities.$inferSelect
export type PriorityListRow = PriorityRow

const PRIORITY_NAME_IN_USE = 'Priority name is already in use'

export interface PriorityListParams extends ListParams {
	sort: 'rank' | 'name' | 'description'
	order: 'asc' | 'desc'
}

export async function listPriorities(params: PriorityListParams): Promise<Page<PriorityListRow>> {
	const orderColumn =
		params.sort === 'name'
			? priorities.name
			: params.sort === 'description'
				? priorities.description
				: priorities.rank
	return await pageRows(
		priorities,
		searchCondition(params.search, [priorities.name, priorities.description]),
		[orderOf(orderColumn, params.order), asc(priorities.name), asc(priorities.id)],
		params,
	)
}

export function getPriority(id: number): Promise<Result<PriorityRow, Error>> {
	return findById(priorities, id, 'Priority not found')
}

export async function createPriority(input: PriorityCreate): Promise<Result<PriorityRow, Error>> {
	if (await isTaken(priorities, eq(priorities.name, input.name))) {
		return Result.err(new DuplicateError(PRIORITY_NAME_IN_USE))
	}
	const row: Omit<PriorityRow, 'id'> = {
		name: input.name,
		rank: input.rank,
		description: input.description ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb().insert(priorities).values(row).returning({ id: priorities.id }),
			),
		PRIORITY_NAME_IN_USE,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('priority', await getPriority(id.value))
}

export async function updatePriority(
	id: number,
	input: PriorityUpdate,
): Promise<Result<PriorityRow, Error>> {
	const current = await getPriority(id)
	if (Result.isError(current)) {
		return current
	}
	if (
		input.name !== undefined &&
		(await isTaken(priorities, eq(priorities.name, input.name), id))
	) {
		return Result.err(new DuplicateError(PRIORITY_NAME_IN_USE))
	}
	const patch = pickDefined(input, ['name', 'rank', 'description'])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(priorities).set(patch).where(eq(priorities.id, id)),
			PRIORITY_NAME_IN_USE,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('priority', current.value, await getPriority(id))
}

export async function deletePriority(id: number): Promise<Result<PriorityRow, Error>> {
	const current = await getPriority(id)
	if (Result.isError(current)) {
		return current
	}
	if (await exists(service_level_targets, eq(service_level_targets.priority_id, id))) {
		return Result.err(
			new ConflictError('Priority is used by service levels; remove its targets first'),
		)
	}
	const deleted = await tryWrite(() => getDb().delete(priorities).where(eq(priorities.id, id)))
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('priority', current.value)
}

// ---------------------------------------------------------------------------
// Service levels (SLA)
// ---------------------------------------------------------------------------

export type ServiceLevelRow = typeof service_levels.$inferSelect
/** A service level with its targets, sorted by priority rank. */
export type ServiceLevelDetail = ServiceLevelRow & { targets: ServiceLevelTargetJson[] }
export type ServiceLevelListRow = ServiceLevelRow & { target_count: number }

const SERVICE_LEVEL_NAME_IN_USE = 'Service level name is already in use'

export interface ServiceLevelListParams extends ListParams {
	sort: 'name' | 'description'
	order: 'asc' | 'desc'
}

/** Windows in weekday order, so stored sets and changelog diffs stay stable. */
function sortedHours(windows: ServiceWindow[]): ServiceWindow[] {
	return [...windows].sort((a, b) => a.day - b.day)
}

export async function listServiceLevels(
	params: ServiceLevelListParams,
): Promise<Page<ServiceLevelListRow>> {
	const orderColumn =
		params.sort === 'description' ? service_levels.description : service_levels.name
	const page = await pageRows(
		service_levels,
		searchCondition(params.search, [service_levels.name, service_levels.description]),
		[orderOf(orderColumn, params.order), asc(service_levels.id)],
		params,
	)
	const counts = await countBy(
		service_level_targets.service_level_id,
		page.items.map((r) => r.id),
	)
	return {
		...page,
		items: page.items.map((r) => ({ ...r, target_count: counts.get(r.id) ?? 0 })),
	}
}

async function targetsOf(serviceLevelId: number): Promise<ServiceLevelTargetJson[]> {
	const rows = await getDb()
		.select({
			priority_id: service_level_targets.priority_id,
			priority_name: priorities.name,
			priority_rank: priorities.rank,
			response_minutes: service_level_targets.response_minutes,
			resolution_minutes: service_level_targets.resolution_minutes,
			around_the_clock: service_level_targets.around_the_clock,
		})
		.from(service_level_targets)
		.innerJoin(priorities, eq(priorities.id, service_level_targets.priority_id))
		.where(eq(service_level_targets.service_level_id, serviceLevelId))
		.orderBy(asc(priorities.rank), asc(priorities.name))
	return rows.map((r) => ({ ...r, around_the_clock: r.around_the_clock !== 0 }))
}

export async function getServiceLevel(id: number): Promise<Result<ServiceLevelDetail, Error>> {
	const row = await findById(service_levels, id, 'Service level not found')
	if (Result.isError(row)) {
		return row
	}
	return Result.ok({ ...row.value, targets: await targetsOf(id) })
}

/** Every target must point at an existing priority. */
async function checkTargetPriorities(targets: ServiceLevelTarget[]): Promise<Result<void, Error>> {
	for (const target of targets) {
		if (!(await exists(priorities, eq(priorities.id, target.priority_id)))) {
			return Result.err(new NotFoundError('Priority not found'))
		}
	}
	return Result.ok(undefined)
}

/** Replaces the target set of a service level (caller runs it in a transaction). */
async function writeTargets(serviceLevelId: number, targets: ServiceLevelTarget[]): Promise<void> {
	await getDb()
		.delete(service_level_targets)
		.where(eq(service_level_targets.service_level_id, serviceLevelId))
	if (targets.length === 0) {
		return
	}
	await getDb()
		.insert(service_level_targets)
		.values(
			targets.map((t) => ({
				service_level_id: serviceLevelId,
				priority_id: t.priority_id,
				response_minutes: t.response_minutes,
				resolution_minutes: t.resolution_minutes,
				around_the_clock: t.around_the_clock ? 1 : 0,
			})),
		)
}

export async function createServiceLevel(
	input: ServiceLevelCreate,
): Promise<Result<ServiceLevelDetail, Error>> {
	if (await isTaken(service_levels, eq(service_levels.name, input.name))) {
		return Result.err(new DuplicateError(SERVICE_LEVEL_NAME_IN_USE))
	}
	const checked = await checkTargetPriorities(input.targets)
	if (Result.isError(checked)) {
		return checked
	}
	const row: Omit<ServiceLevelRow, 'id'> = {
		name: input.name,
		description: input.description ?? null,
		service_hours: sortedHours(input.service_hours),
		holiday_region: input.holiday_region ?? null,
	}
	const id = await tryWrite(
		() =>
			withTransaction(async () => {
				const newId = insertedId(
					await getDb()
						.insert(service_levels)
						.values(row)
						.returning({ id: service_levels.id }),
				)
				await writeTargets(newId, input.targets)
				return newId
			}),
		SERVICE_LEVEL_NAME_IN_USE,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('service_level', await getServiceLevel(id.value))
}

export async function updateServiceLevel(
	id: number,
	input: ServiceLevelUpdate,
): Promise<Result<ServiceLevelDetail, Error>> {
	const current = await getServiceLevel(id)
	if (Result.isError(current)) {
		return current
	}
	if (
		input.name !== undefined &&
		(await isTaken(service_levels, eq(service_levels.name, input.name), id))
	) {
		return Result.err(new DuplicateError(SERVICE_LEVEL_NAME_IN_USE))
	}
	const targets = input.targets
	if (targets !== undefined) {
		const checked = await checkTargetPriorities(targets)
		if (Result.isError(checked)) {
			return checked
		}
	}
	const patch = {
		...pickDefined(input, ['name', 'description', 'holiday_region']),
		...(input.service_hours === undefined
			? {}
			: { service_hours: sortedHours(input.service_hours) }),
	}
	if (!isPatchEmpty(patch) || targets !== undefined) {
		const written = await tryWrite(
			() =>
				withTransaction(async () => {
					if (!isPatchEmpty(patch)) {
						await getDb()
							.update(service_levels)
							.set(patch)
							.where(eq(service_levels.id, id))
					}
					if (targets !== undefined) {
						await writeTargets(id, targets)
					}
				}),
			SERVICE_LEVEL_NAME_IN_USE,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('service_level', current.value, await getServiceLevel(id))
}

export async function deleteServiceLevel(id: number): Promise<Result<ServiceLevelDetail, Error>> {
	const current = await getServiceLevel(id)
	if (Result.isError(current)) {
		return current
	}
	// Targets go with the service level (FK cascade).
	const deleted = await tryWrite(() =>
		getDb().delete(service_levels).where(eq(service_levels.id, id)),
	)
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('service_level', current.value)
}
