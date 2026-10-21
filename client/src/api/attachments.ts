/**
 * Attachments API wrappers: image list, multipart upload / replace, edit,
 * delete and the floor plan of the marked image over the hono RPC client.
 * Errors surface as `Result.err` with the server's `{ error }` message.
 * Images load straight from `attachment_file_url` (same-origin, the session
 * cookie authorizes them).
 */
import type { Result } from 'better-result'
import type {
	AttachmentJson,
	AttachmentUpdate,
	DeleteQuery,
	FloorplanAreaJson,
	FloorplanCandidateJson,
	FloorplanJson,
	FloorplanLinkJson,
	FloorplanListJson,
	FloorplanListQuery,
	FloorplanOutletJson,
	FloorplanPlacementJson,
	FloorplanPortJson,
	FloorplanPut,
} from 'shared/src/types'
import { t } from '../i18n'
import { by_id, client, failed, to_query, to_result } from './client'

export type {
	AttachmentJson,
	FloorplanAreaJson,
	FloorplanCandidateJson,
	FloorplanJson,
	FloorplanLinkJson,
	FloorplanListJson,
	FloorplanOutletJson,
	FloorplanPlacementJson,
	FloorplanPortJson,
	FloorplanPut,
}

/** Owner of an attachment: exactly one of the two ids. */
export type AttachmentOwner = { site_id: number } | { location_id: number }

export async function fetch_attachments(
	owner: AttachmentOwner,
): Promise<Result<AttachmentJson[], Error>> {
	const res = await client.attachments.$get({
		query: to_query({
			site: 'site_id' in owner ? owner.site_id : undefined,
			location: 'location_id' in owner ? owner.location_id : undefined,
		}),
	})
	return to_result<AttachmentJson[]>(res, failed.list('noun.attachment'))
}

export async function fetch_attachment(id: number): Promise<Result<AttachmentJson, Error>> {
	const res = await client.attachments[':id'].$get(by_id(id))
	return to_result<AttachmentJson>(res, failed.load('noun.attachment'))
}

export async function upload_attachment(
	owner: AttachmentOwner,
	file: File,
	description?: string,
): Promise<Result<AttachmentJson, Error>> {
	const res = await client.attachments.$post({
		form: {
			file,
			...('site_id' in owner
				? { site_id: String(owner.site_id) }
				: { location_id: String(owner.location_id) }),
			...(description ? { description } : {}),
		},
	})
	return to_result<AttachmentJson>(res, t('api.uploadFailed', { name: file.name }))
}

export async function update_attachment(
	id: number,
	patch: AttachmentUpdate,
): Promise<Result<AttachmentJson, Error>> {
	const res = await client.attachments[':id'].$patch({ ...by_id(id), json: patch })
	return to_result<AttachmentJson>(res, failed.update('noun.attachment'))
}

/** Replaces the image file; description and floor-plan data stay. */
export async function replace_attachment_file(
	id: number,
	file: File,
): Promise<Result<AttachmentJson, Error>> {
	const res = await client.attachments[':id'].file.$put({ ...by_id(id), form: { file } })
	return to_result<AttachmentJson>(res, t('api.uploadFailed', { name: file.name }))
}

/** `opts.confirm` also deletes the floor-plan data of a marked image (see `FloorplanImpactError`). */
export async function delete_attachment(
	id: number,
	opts?: DeleteQuery,
): Promise<Result<unknown, Error>> {
	const res = await client.attachments[':id'].$delete({
		...by_id(id),
		query: to_query({ confirm: opts?.confirm }),
	})
	return to_result<unknown>(res, failed.delete('noun.attachment'))
}

/** Areas and markers of a floor plan, limited to the requester's tenant scope. */
export async function fetch_floorplan(id: number): Promise<Result<FloorplanJson, Error>> {
	const res = await client.attachments[':id'].plan.$get(by_id(id))
	return to_result<FloorplanJson>(res, failed.load('noun.floorplan'))
}

/** Racks and devices the editor may place on this plan (those already on it included). */
export async function fetch_floorplan_candidates(
	id: number,
): Promise<Result<FloorplanCandidateJson[], Error>> {
	const res = await client.attachments[':id'].plan.candidates.$get(by_id(id))
	return to_result<FloorplanCandidateJson[]>(res, failed.load('noun.floorplan'))
}

/** Replaces the plan's areas and markers atomically; answers with the resolved plan. */
export async function put_floorplan(
	id: number,
	plan: FloorplanPut,
): Promise<Result<FloorplanJson, Error>> {
	const res = await client.attachments[':id'].plan.$put({ ...by_id(id), json: plan })
	return to_result<FloorplanJson>(res, failed.update('noun.floorplan'))
}

/** What a floor-plan link lookup is about: exactly one of the five ids. */
export type FloorplanLinkTarget =
	| { site: number }
	| { location: number }
	| { rack: number }
	| { device: number }
	| { interface: number }

/**
 * Floor plans referencing an object: the plan a rack or device is placed on
 * (0 or 1), or the plans with an area linking to a site or location.
 */
export async function fetch_floorplan_links(
	target: FloorplanLinkTarget,
): Promise<Result<FloorplanLinkJson[], Error>> {
	const res = await client.attachments['floorplan-links'].$get({
		query: to_query({
			site: 'site' in target ? target.site : undefined,
			location: 'location' in target ? target.location : undefined,
			rack: 'rack' in target ? target.rack : undefined,
			device: 'device' in target ? target.device : undefined,
			interface: 'interface' in target ? target.interface : undefined,
		}),
	})
	return to_result<FloorplanLinkJson[]>(res, failed.list('noun.floorplan'))
}

/**
 * Placed outlets of a device: a patch panel's own placed rear ports, or the
 * placed rear ports any other device's ports are cabled to.
 */
export async function fetch_outlets(
	deviceId: number,
): Promise<Result<FloorplanOutletJson[], Error>> {
	const res = await client.attachments.outlets.$get({ query: to_query({ device: deviceId }) })
	return to_result<FloorplanOutletJson[]>(res, failed.list('noun.floorplan'))
}

/** Every marked floor plan, narrowed by search and tenant filters. */
export async function fetch_floorplans(
	query: Partial<FloorplanListQuery>,
): Promise<Result<FloorplanListJson[], Error>> {
	const res = await client.attachments.floorplans.$get({ query: to_query(query) })
	return to_result<FloorplanListJson[]>(res, failed.list('noun.floorplan'))
}

/** Image URL; the storage key changes with every file, so a replace busts the cache. */
export function attachment_file_url(attachment: AttachmentJson): string {
	return `/api/attachments/${attachment.id}/file?v=${encodeURIComponent(attachment.storage_key)}`
}
