/**
 * Attachments: PNG / JPEG images owned by one site or location. The row
 * holds the metadata, the file lives on disk (`storage.ts`). A new file is
 * written (tmp, then renamed) before its row; a failed insert removes it
 * again. A delete removes the row first and the file after the commit, so a
 * crash leaves at worst an orphan file, which the startup sweep removes.
 */
import { Result } from 'better-result'
import { and, asc, eq, ne, type SQL, sql } from 'drizzle-orm'
import type { AttachmentJson, AttachmentMime, AttachmentUpdate } from 'shared/src/schemas'
import { attachments, locations, sites } from '../schema'
import {
	attachmentFileName,
	listAttachmentFiles,
	removeAttachmentFiles,
	removeStoredFile,
	writeAttachmentFile,
} from '../storage'
import { IMAGE_EXTENSIONS, readImageInfo } from '../util/image'
import { nowSeconds } from '../util/time'
import { logCreate, logDelete, logUpdate } from './changelog'
import { getDb, withTransaction } from './connection'
import { checkExists, findById, insertedId, isPatchEmpty, pickDefined, tryWrite } from './list'

export type AttachmentRow = typeof attachments.$inferSelect

/** Owner of an attachment: exactly one of the two ids is set. */
export interface AttachmentOwner {
	site_id?: number
	location_id?: number
}

/** Uploaded file: the client's file name and the raw bytes. */
export interface AttachmentUpload {
	name: string
	bytes: Uint8Array
}

const NOT_FOUND = 'Attachment not found'
const FLOORPLAN_TAKEN = 'Another attachment is already marked as the floor plan'

/** Stored files are `<uuid>.<ext>`, plus `<uuid>.tmp` while being written. */
const STORED_FILE = new RegExp(
	`^[0-9a-f-]{36}\\.(?:tmp|${Object.values(IMAGE_EXTENSIONS).join('|')})$`,
)

function toJson(row: AttachmentRow): AttachmentJson {
	return { ...row, is_floorplan: row.is_floorplan !== 0 }
}

function ownerCondition(owner: AttachmentOwner): SQL {
	if (owner.site_id !== undefined) {
		return eq(attachments.site_id, owner.site_id)
	}
	if (owner.location_id !== undefined) {
		return eq(attachments.location_id, owner.location_id)
	}
	return sql`false`
}

/** 404 when the owning site or location does not exist. */
async function checkOwner(owner: AttachmentOwner): Promise<Result<undefined, Error>> {
	if (owner.site_id !== undefined) {
		return checkExists(sites, owner.site_id, 'Site not found')
	}
	return checkExists(locations, owner.location_id, 'Location not found')
}

/**
 * Display name of an upload: the base name without control characters,
 * capped in length. Falls back to `image.<ext>` when nothing is left.
 */
function cleanFilename(name: string, mime: AttachmentMime): string {
	const base = (name.split(/[/\\]/).pop() ?? '')
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.trim()
		.slice(0, 200)
	return base || `image.${IMAGE_EXTENSIONS[mime]}`
}

/** Checks the bytes and stores them under a fresh key; returns the row fields. */
async function storeUpload(
	upload: AttachmentUpload,
): Promise<
	Result<
		Pick<
			AttachmentRow,
			'filename' | 'mime' | 'size_bytes' | 'width_px' | 'height_px' | 'storage_key'
		>,
		Error
	>
> {
	const info = readImageInfo(upload.bytes)
	if (Result.isError(info)) {
		return info
	}
	const storageKey = crypto.randomUUID()
	const written = await writeAttachmentFile(storageKey, info.value.mime, upload.bytes)
	if (Result.isError(written)) {
		return written
	}
	return Result.ok({
		filename: cleanFilename(upload.name, info.value.mime),
		mime: info.value.mime,
		size_bytes: upload.bytes.length,
		width_px: info.value.width,
		height_px: info.value.height,
		storage_key: storageKey,
	})
}

/** Attachments of one owner, oldest first. */
export async function listAttachments(
	owner: AttachmentOwner,
): Promise<Result<AttachmentJson[], Error>> {
	const found = await checkOwner(owner)
	if (Result.isError(found)) {
		return found
	}
	const rows = await getDb()
		.select()
		.from(attachments)
		.where(ownerCondition(owner))
		.orderBy(asc(attachments.created_at), asc(attachments.id))
	return Result.ok(rows.map(toJson))
}

/** Raw row including the storage key (file serving, replace, delete). */
export function getAttachmentRow(id: number): Promise<Result<AttachmentRow, Error>> {
	return findById(attachments, id, NOT_FOUND)
}

export async function getAttachment(id: number): Promise<Result<AttachmentJson, Error>> {
	return (await getAttachmentRow(id)).map(toJson)
}

export async function createAttachment(
	owner: AttachmentOwner,
	upload: AttachmentUpload,
	input: { description?: string; created_by: number | null },
): Promise<Result<AttachmentJson, Error>> {
	const found = await checkOwner(owner)
	if (Result.isError(found)) {
		return found
	}
	const stored = await storeUpload(upload)
	if (Result.isError(stored)) {
		return stored
	}
	const id = await tryWrite(async () =>
		insertedId(
			await getDb()
				.insert(attachments)
				.values({
					...stored.value,
					site_id: owner.site_id ?? null,
					location_id: owner.location_id ?? null,
					description: input.description || null,
					created_at: nowSeconds(),
					created_by: input.created_by,
				})
				.returning({ id: attachments.id }),
		),
	)
	if (Result.isError(id)) {
		await removeAttachmentFiles([stored.value])
		return id
	}
	return await logCreate('attachment', await getAttachment(id.value))
}

/**
 * Replaces the image of an attachment. Areas and placements use normalized
 * coordinates and stay as they are. The new file gets a new storage key;
 * the old file is removed once the row points at the new one.
 */
export async function replaceAttachmentFile(
	id: number,
	upload: AttachmentUpload,
): Promise<Result<AttachmentJson, Error>> {
	const current = await getAttachmentRow(id)
	if (Result.isError(current)) {
		return current
	}
	const stored = await storeUpload(upload)
	if (Result.isError(stored)) {
		return stored
	}
	const written = await tryWrite(() =>
		getDb().update(attachments).set(stored.value).where(eq(attachments.id, id)),
	)
	if (Result.isError(written)) {
		await removeAttachmentFiles([stored.value])
		return written
	}
	await removeAttachmentFiles([current.value])
	return await logUpdate('attachment', toJson(current.value), await getAttachment(id))
}

/**
 * Updates the description and the floor-plan mark. Marking unmarks the
 * owner's previous floor plan in the same transaction.
 */
export async function updateAttachment(
	id: number,
	input: AttachmentUpdate,
): Promise<Result<AttachmentJson, Error>> {
	const current = await getAttachmentRow(id)
	if (Result.isError(current)) {
		return current
	}
	const row = current.value
	const patch: Partial<AttachmentRow> = pickDefined(input, ['description'])
	if (input.is_floorplan !== undefined) {
		patch.is_floorplan = input.is_floorplan ? 1 : 0
	}
	if (!isPatchEmpty(patch)) {
		const owner: AttachmentOwner = {
			site_id: row.site_id ?? undefined,
			location_id: row.location_id ?? undefined,
		}
		const written = await tryWrite(
			() =>
				withTransaction(async () => {
					if (input.is_floorplan === true && row.is_floorplan === 0) {
						await getDb()
							.update(attachments)
							.set({ is_floorplan: 0 })
							.where(
								and(
									ownerCondition(owner),
									ne(attachments.id, id),
									eq(attachments.is_floorplan, 1),
								),
							)
					}
					await getDb().update(attachments).set(patch).where(eq(attachments.id, id))
				}),
			FLOORPLAN_TAKEN,
		)
		if (Result.isError(written)) {
			return written
		}
	}
	return await logUpdate('attachment', toJson(row), await getAttachment(id))
}

export async function deleteAttachment(id: number): Promise<Result<AttachmentJson, Error>> {
	const current = await getAttachmentRow(id)
	if (Result.isError(current)) {
		return current
	}
	const deleted = await tryWrite(() => getDb().delete(attachments).where(eq(attachments.id, id)))
	if (Result.isError(deleted)) {
		return deleted
	}
	await removeAttachmentFiles([current.value])
	return await logDelete('attachment', toJson(current.value))
}

/**
 * Deletes every attachment of an owner that is being deleted. Runs on the
 * caller's `getDb()` (its transaction) and returns the removed rows: the
 * caller removes their files with `removeAttachmentFiles` after the commit.
 */
export async function deleteOwnerAttachments(owner: AttachmentOwner): Promise<AttachmentRow[]> {
	const rows = await getDb().delete(attachments).where(ownerCondition(owner)).returning()
	for (const row of rows) {
		await logDelete('attachment', toJson(row))
	}
	return rows
}

/**
 * Startup sweep: removes stored files (and leftover `.tmp` files) without a
 * row, and logs rows whose file is missing. Must run before the server
 * accepts uploads. Unrelated files in the directory are left alone.
 */
export async function sweepAttachmentFiles(): Promise<
	Result<{ removed: number; missing: number }, Error>
> {
	const files = await listAttachmentFiles()
	if (Result.isError(files)) {
		return files
	}
	const rows = await getDb()
		.select({
			id: attachments.id,
			storage_key: attachments.storage_key,
			mime: attachments.mime,
		})
		.from(attachments)
	const expected = new Set(rows.map((row) => attachmentFileName(row.storage_key, row.mime)))
	let removed = 0
	for (const name of files.value) {
		if (STORED_FILE.test(name) && !expected.has(name)) {
			const gone = await removeStoredFile(name)
			if (Result.isError(gone)) {
				return gone
			}
			removed++
		}
	}
	const present = new Set(files.value)
	const missing = rows.filter(
		(row) => !present.has(attachmentFileName(row.storage_key, row.mime)),
	)
	for (const row of missing) {
		console.warn(`Attachment #${row.id}: file ${row.storage_key} is missing`)
	}
	return Result.ok({ removed, missing: missing.length })
}
