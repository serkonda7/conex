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
	FloorplanAreaJson,
	FloorplanJson,
	FloorplanPlacementJson,
} from 'shared/src/types'
import { t } from '../i18n'
import { by_id, client, failed, to_query, to_result } from './client'

export type { AttachmentJson, FloorplanAreaJson, FloorplanJson, FloorplanPlacementJson }

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

export async function delete_attachment(id: number): Promise<Result<unknown, Error>> {
	const res = await client.attachments[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.attachment'))
}

/** Areas and markers of a floor plan, limited to the requester's tenant scope. */
export async function fetch_floorplan(id: number): Promise<Result<FloorplanJson, Error>> {
	const res = await client.attachments[':id'].plan.$get(by_id(id))
	return to_result<FloorplanJson>(res, failed.load('noun.floorplan'))
}

/** Image URL; the storage key changes with every file, so a replace busts the cache. */
export function attachment_file_url(attachment: AttachmentJson): string {
	return `/api/attachments/${attachment.id}/file?v=${encodeURIComponent(attachment.storage_key)}`
}
