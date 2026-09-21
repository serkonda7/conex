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
	requireWrite,
	scopeTenantId,
	shelfTenant,
} from '../authz'
import { createShelf, deleteShelf, getShelf, listShelves, updateShelf } from '../db/racks'
import { authMiddleware } from '../middleware/auth'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'

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
	.post('/', vValidator('json', ShelfCreateSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
		const body = c.req.valid('json')
		const tenant = rackTenant(body.rack_id)
		if (tenant !== undefined) {
			const scopeDenied = checkWrite(c, tenant)
			if (scopeDenied) {
				return scopeDenied
			}
		}
		const result = createShelf(body)
		if (Result.isOk(result)) {
			return c.json(result.value, 201)
		}
		return sendResult(c, result)
	})
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
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', ShelfUpdateSchema, onValidationError),
		(c) => {
			const denied = requireWrite(c)
			if (denied) {
				return denied
			}
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
			const result = updateShelf(id, c.req.valid('json'))
			if (Result.isOk(result)) {
				return c.json(result.value)
			}
			return sendResult(c, result)
		},
	)
	.delete('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const denied = requireWrite(c)
		if (denied) {
			return denied
		}
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
		const result = deleteShelf(id)
		if (Result.isOk(result)) {
			return c.json(result.value)
		}
		return sendResult(c, result)
	})
