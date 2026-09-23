import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	ShelfCreateSchema,
	ShelfListQuerySchema,
	ShelfUpdateSchema,
} from 'shared/src/schemas'
import {
	checkRead,
	checkWrite,
	rackTenant,
	requestUser,
	scopeTenantId,
	shelfTenant,
} from '../authz'
import { createShelf, deleteShelf, getShelf, listShelves, updateShelf } from '../db/racks'
import { authMiddleware } from '../middleware/auth'
import { requireWriteMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { sendCreated, sendRow } from './helpers'

/**
 * Shelves carry no tenant of their own: every gate follows the parent rack's
 * tenant. Listing is scope-filtered in SQL; single-object routes resolve the
 * rack tenant (`undefined` = rack gone, fall through to the service 404).
 */
export const shelvesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', ShelfListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		if (query.rack !== undefined) {
			const tenant = rackTenant(query.rack)
			if (tenant !== undefined) {
				const denied = checkRead(c, tenant)
				if (denied) {
					return denied
				}
			}
		}
		const scope = scopeTenantId(requestUser(c))
		return c.json(
			listShelves({
				search: query.search,
				page: query.page,
				limit: query.limit,
				rack: query.rack,
				...(scope !== null ? { scopeTenantId: scope } : {}),
			}),
		)
	})
	.post(
		'/',
		requireWriteMiddleware,
		vValidator('json', ShelfCreateSchema, onValidationError),
		(c) => {
			const body = c.req.valid('json')
			const tenant = rackTenant(body.rack_id)
			if (tenant !== undefined) {
				const scopeDenied = checkWrite(c, tenant)
				if (scopeDenied) {
					return scopeDenied
				}
			}
			return sendCreated(c, createShelf(body))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const result = getShelf(c.req.valid('param').id)
		if (Result.isError(result)) {
			return sendResult(c, result)
		}
		const tenant = shelfTenant(result.value.id)
		if (tenant !== undefined) {
			const denied = checkRead(c, tenant)
			if (denied) {
				return denied
			}
		}
		return c.json(result.value)
	})
	.patch(
		'/:id',
		requireWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', ShelfUpdateSchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const current = getShelf(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			const tenant = shelfTenant(id)
			if (tenant !== undefined) {
				const scopeDenied = checkWrite(c, tenant)
				if (scopeDenied) {
					return scopeDenied
				}
			}
			return sendRow(c, updateShelf(id, c.req.valid('json')))
		},
	)
	.delete(
		'/:id',
		requireWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const current = getShelf(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			const tenant = shelfTenant(id)
			if (tenant !== undefined) {
				const scopeDenied = checkWrite(c, tenant)
				if (scopeDenied) {
					return scopeDenied
				}
			}
			return sendRow(c, deleteShelf(id))
		},
	)
