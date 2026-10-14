import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
	ATTACHMENT_MAX_BYTES,
	AttachmentCreateSchema,
	AttachmentFileReplaceSchema,
	AttachmentListQuerySchema,
	AttachmentUpdateSchema,
	EntityParamsSchema,
} from 'shared/src/schemas'
import { checkTenant, requestUser } from '../authz'
import {
	type AttachmentRow,
	type AttachmentUpload,
	createAttachment,
	deleteAttachment,
	getAttachmentRow,
	listAttachments,
	replaceAttachmentFile,
	updateAttachment,
} from '../db/attachments'
import { ownerTenant } from '../db/owners'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { attachmentPath } from '../storage'
import { contentDisposition, jsonError } from '../util/http'
import { sendCreated, sendResult } from '../util/result_response'

/** Room for the multipart boundaries and the small text fields next to the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/** Rejects oversized uploads while reading, before the body is parsed. */
const uploadLimit = bodyLimit({
	maxSize: ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES,
	onError: (c: Context): Response => jsonError(c, 'Image is larger than 10 MB', 413),
})

/** Loads an attachment the requester may access (via its owner): the row, or the 404/403 response. */
async function loadAttachment(c: Context, id: number): Promise<AttachmentRow | Response> {
	const row = await getAttachmentRow(id)
	if (Result.isError(row)) {
		return sendResult(c, row)
	}
	return checkTenant(c, (await ownerTenant(row.value)) ?? null) ?? row.value
}

async function uploadOf(file: File): Promise<AttachmentUpload> {
	return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
}

/**
 * Image attachments of sites and locations. Wired by hand (not
 * `makeTenantApp`) for the multipart and binary endpoints. Tenant scope
 * comes from the owning site or location; the files are served only after
 * that check.
 */
export const attachmentsApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.get('/', vValidator('query', AttachmentListQuerySchema, onValidationError), async (c) => {
		const query = c.req.valid('query')
		const owner = { site_id: query.site, location_id: query.location }
		return (
			checkTenant(c, await ownerTenant(owner)) ?? sendResult(c, await listAttachments(owner))
		)
	})
	.post(
		'/',
		requirePermissionMiddleware('edit'),
		uploadLimit,
		vValidator('form', AttachmentCreateSchema, onValidationError),
		async (c) => {
			const body = c.req.valid('form')
			const owner = { site_id: body.site_id, location_id: body.location_id }
			// A missing owner answers 404 from the service; an out-of-scope one
			// answers 403 here before anything is written.
			return (
				checkTenant(c, await ownerTenant(owner)) ??
				sendCreated(
					c,
					await createAttachment(owner, await uploadOf(body.file), {
						description: body.description,
						created_by: requestUser(c).id,
					}),
				)
			)
		},
	)
	.patch(
		'/:id',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', AttachmentUpdateSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const row = await loadAttachment(c, id)
			if (row instanceof Response) {
				return row
			}
			return sendResult(c, await updateAttachment(id, c.req.valid('json')))
		},
	)
	.put(
		'/:id/file',
		requirePermissionMiddleware('edit'),
		uploadLimit,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('form', AttachmentFileReplaceSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const row = await loadAttachment(c, id)
			if (row instanceof Response) {
				return row
			}
			const upload = await uploadOf(c.req.valid('form').file)
			return sendResult(c, await replaceAttachmentFile(id, upload))
		},
	)
	.delete(
		'/:id',
		requirePermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const row = await loadAttachment(c, id)
			if (row instanceof Response) {
				return row
			}
			return sendResult(c, await deleteAttachment(id))
		},
	)
	.get('/:id/file', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		const row = await loadAttachment(c, c.req.valid('param').id)
		if (row instanceof Response) {
			return row
		}
		// The storage key changes with every file, so it is a strong ETag.
		const etag = `"${row.storage_key}"`
		const headers: Record<string, string> = {
			ETag: etag,
			'Cache-Control': 'private, no-cache',
			'X-Content-Type-Options': 'nosniff',
		}
		if (c.req.header('If-None-Match')?.includes(etag)) {
			return new Response(null, { status: 304, headers })
		}
		const file = Bun.file(attachmentPath(row.storage_key, row.mime))
		if (!(await file.exists())) {
			console.warn(`Attachment #${row.id}: file ${row.storage_key} is missing`)
			return jsonError(c, 'Attachment file is missing', 404)
		}
		return new Response(file, {
			headers: {
				...headers,
				'Content-Type': row.mime,
				'Content-Disposition': contentDisposition('inline', row.filename),
			},
		})
	})
