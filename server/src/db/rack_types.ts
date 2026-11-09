import { Result } from 'better-result'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import type { RackTypeCreate, RackTypeListQuery, RackTypeUpdate } from 'shared/src/schemas'
import { manufacturers, rack_types, racks } from '../schema'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb } from './connection'
import { ConflictError } from './errors'
import type { ListParams, Page } from './list'
import {
	checkExists,
	countWhere,
	exists,
	insertedId,
	isPatchEmpty,
	orderOf,
	pageRows,
	pickDefined,
	searchCondition,
	tryWrite,
} from './list'
import { checkRackHeight, getRackType, type RackTypeRow } from './racks'

export { getRackType, type RackTypeRow }

/** `instance_count`: racks built from the type. */
export type RackTypeListRow = RackTypeRow & { instance_count: number }

const RACK_TYPE_EXISTS = 'Rack type already exists'

export interface RackTypeListParams extends ListParams {
	manufacturer?: number[]
	form_factor?: RackTypeListQuery['form_factor']
	height?: number[]
	sort: RackTypeListQuery['sort']
	order: 'asc' | 'desc'
}

/** Racks built from the outer rack type row. */
const instanceCount = countWhere(racks.rack_type_id, rack_types.id)

export async function listRackTypes(params: RackTypeListParams): Promise<Page<RackTypeListRow>> {
	const where = and(
		params.search
			? or(
					searchCondition(params.search, [rack_types.model, rack_types.description]),
					inArray(
						rack_types.manufacturer_id,
						getDb()
							.select({ id: manufacturers.id })
							.from(manufacturers)
							.where(searchCondition(params.search, [manufacturers.name])),
					),
				)
			: undefined,
		params.manufacturer ? inArray(rack_types.manufacturer_id, params.manufacturer) : undefined,
		params.form_factor ? inArray(rack_types.form_factor, params.form_factor) : undefined,
		params.height ? inArray(rack_types.u_height, params.height) : undefined,
	)
	const orderColumns = {
		model: rack_types.model,
		manufacturer: sql`(SELECT ${manufacturers.name} FROM ${manufacturers} WHERE ${manufacturers.id} = ${rack_types.manufacturer_id})`,
		form_factor: rack_types.form_factor,
		u_height: rack_types.u_height,
		description: rack_types.description,
		comments: rack_types.comments,
		racks: instanceCount,
	}
	return await pageRows(
		rack_types,
		where,
		[orderOf(orderColumns[params.sort], params.order), asc(rack_types.id)],
		params,
		{ instance_count: instanceCount },
	)
}

function checkManufacturerExists(id: number | undefined): Promise<Result<undefined, Error>> {
	return checkExists(manufacturers, id, 'Manufacturer not found')
}

export async function createRackType(input: RackTypeCreate): Promise<Result<RackTypeRow, Error>> {
	const manufacturer = await checkManufacturerExists(input.manufacturer_id)
	if (Result.isError(manufacturer)) {
		return manufacturer
	}
	const row: Omit<RackTypeRow, 'id' | 'width'> = {
		manufacturer_id: input.manufacturer_id,
		model: input.model,
		form_factor: input.form_factor,
		u_height: input.u_height,
		description: input.description ?? null,
		comments: input.comments ?? null,
	}
	const id = await tryWrite(
		async () =>
			insertedId(
				await getDb().insert(rack_types).values(row).returning({ id: rack_types.id }),
			),
		RACK_TYPE_EXISTS,
	)
	if (Result.isError(id)) {
		return id
	}
	return await logCreate('rack_type', await getRackType(id.value))
}

export async function updateRackType(
	id: number,
	input: RackTypeUpdate,
): Promise<Result<RackTypeRow, Error>> {
	const current = await getRackType(id)
	if (Result.isError(current)) {
		return current
	}
	const type = current.value
	const manufacturer = await checkManufacturerExists(input.manufacturer_id)
	if (Result.isError(manufacturer)) {
		return manufacturer
	}
	if (input.u_height !== undefined && input.u_height < type.u_height) {
		const built = await getDb()
			.select({ id: racks.id })
			.from(racks)
			.where(eq(racks.rack_type_id, id))
		for (const rack of built) {
			const fits = await checkRackHeight(rack.id, input.u_height)
			if (Result.isError(fits)) {
				return fits
			}
		}
	}
	const patch = pickDefined(input, [
		'manufacturer_id',
		'model',
		'form_factor',
		'u_height',
		'description',
		'comments',
	])
	if (!isPatchEmpty(patch)) {
		const written = await tryWrite(
			() => getDb().update(rack_types).set(patch).where(eq(rack_types.id, id)),
			RACK_TYPE_EXISTS,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('rack_type', type, await getRackType(id))
}

export async function deleteRackType(id: number): Promise<Result<RackTypeRow, Error>> {
	const current = await getRackType(id)
	if (Result.isError(current)) {
		return current
	}
	if (await exists(racks, eq(racks.rack_type_id, id))) {
		return Result.err(new ConflictError('Rack type still has racks; move or delete them first'))
	}
	const deleted = await tryWrite(() => getDb().delete(rack_types).where(eq(rack_types.id, id)))
	if (Result.isError(deleted)) {
		return deleted
	}
	return await logDelete('rack_type', current.value)
}
