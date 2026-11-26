/**
 * Drawn floor plans (v2) over the hono RPC client: the owner's plan, create,
 * load, save (one PUT of the whole plan), delete, the editor's candidates
 * link locations and the building's other floors, and the paged list.
 */
import type { Result } from 'better-result'
import type {
	FloorplanCandidateJson,
	FloorplanDesk,
	FloorplanDeskGroup,
	FloorplanDrawingJson,
	FloorplanDrawingListJson,
	FloorplanDrawingPlacementJson,
	FloorplanDrawingPut,
	FloorplanDrawingRefJson,
	FloorplanLinkLocationJson,
	FloorplanListQuery,
	FloorplanOffset,
	FloorplanOpening,
	FloorplanPartition,
	FloorplanPillar,
	FloorplanReference,
	FloorplanRoom,
	FloorplanStackFloorJson,
	FloorplanStair,
	FloorplanTray,
	FloorplanWall,
	Page,
} from 'shared/src/types'
import { by_id, client, failed, getPage, paging, to_query, to_result } from './client'

export type {
	FloorplanDesk,
	FloorplanDeskGroup,
	FloorplanDrawingJson,
	FloorplanDrawingListJson,
	FloorplanDrawingPlacementJson,
	FloorplanDrawingPut,
	FloorplanLinkLocationJson,
	FloorplanOffset,
	FloorplanOpening,
	FloorplanPartition,
	FloorplanPillar,
	FloorplanReference,
	FloorplanRoom,
	FloorplanStackFloorJson,
	FloorplanStair,
	FloorplanTray,
	FloorplanWall,
}

/** Owner of a drawn plan: a site or a location. */
export type DrawingOwner = { site: number } | { location: number }

/** The owner's drawn plan, or `null` without one. */
export async function fetch_drawing_ref(
	owner: DrawingOwner,
): Promise<Result<FloorplanDrawingRefJson | null, Error>> {
	const res = await client['floorplan-drawings'].owner.$get({
		query: to_query({
			site: 'site' in owner ? owner.site : undefined,
			location: 'location' in owner ? owner.location : undefined,
		}),
	})
	return to_result<FloorplanDrawingRefJson | null>(res, failed.load('noun.drawnFloorplan'))
}

/** Creates the owner's empty drawn plan with the default sheet. */
export async function create_drawing(
	owner: DrawingOwner,
): Promise<Result<FloorplanDrawingJson, Error>> {
	const res = await client['floorplan-drawings'].$post({
		json: 'site' in owner ? { site_id: owner.site } : { location_id: owner.location },
	})
	return to_result<FloorplanDrawingJson>(res, failed.create('noun.drawnFloorplan'))
}

export async function fetch_drawing(id: number): Promise<Result<FloorplanDrawingJson, Error>> {
	const res = await client['floorplan-drawings'][':id'].$get(by_id(id))
	return to_result<FloorplanDrawingJson>(res, failed.load('noun.drawnFloorplan'))
}

/** Replaces the whole plan; answers with the saved plan. */
export async function put_drawing(
	id: number,
	plan: FloorplanDrawingPut,
): Promise<Result<FloorplanDrawingJson, Error>> {
	const res = await client['floorplan-drawings'][':id'].$put({ ...by_id(id), json: plan })
	return to_result<FloorplanDrawingJson>(res, failed.update('noun.drawnFloorplan'))
}

export async function delete_drawing(id: number): Promise<Result<unknown, Error>> {
	const res = await client['floorplan-drawings'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.drawnFloorplan'))
}

/** Racks, devices and outlets the editor may place (those on this plan included). */
export async function fetch_drawing_candidates(
	id: number,
): Promise<Result<FloorplanCandidateJson[], Error>> {
	const res = await client['floorplan-drawings'][':id'].candidates.$get(by_id(id))
	return to_result<FloorplanCandidateJson[]>(res, failed.load('noun.drawnFloorplan'))
}

/** Locations desks and rooms of this plan may link to. */
export async function fetch_drawing_locations(
	id: number,
): Promise<Result<FloorplanLinkLocationJson[], Error>> {
	const res = await client['floorplan-drawings'][':id'].locations.$get(by_id(id))
	return to_result<FloorplanLinkLocationJson[]>(res, failed.load('noun.drawnFloorplan'))
}

/** The other stacked floors of this plan's building, lowest first. */
export async function fetch_drawing_stack(
	id: number,
): Promise<Result<FloorplanStackFloorJson[], Error>> {
	const res = await client['floorplan-drawings'][':id'].stack.$get(by_id(id))
	return to_result<FloorplanStackFloorJson[]>(res, failed.load('noun.drawnFloorplan'))
}

export type DrawingSort = FloorplanListQuery['sort']

/** One page of the drawn plans, narrowed by search and tenant filters. */
export async function fetch_drawings(
	filters: Partial<FloorplanListQuery>,
): Promise<Result<Page<FloorplanDrawingListJson>, Error>> {
	return getPage<FloorplanDrawingListJson>(
		client['floorplan-drawings'].$get({
			query: to_query({
				...paging(filters),
				tenant: filters.tenant,
				tenant_group: filters.tenant_group,
				sort: filters.sort ?? 'site',
				order: filters.order ?? 'asc',
			}),
		}),
		failed.list('noun.drawnFloorplan'),
	)
}
