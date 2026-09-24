import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	ShelfCreateSchema,
	ShelfListQuerySchema,
	ShelfUpdateSchema,
} from 'shared/src/schemas'
import { checkRead, checkWrite, listTenantScope, rackTenant, shelfTenant } from '../authz'
import { createShelf, deleteShelf, getShelf, listShelves, updateShelf } from '../db/shelves'
import { authMiddleware } from '../middleware/auth'
import { requireWriteMiddleware } from '../middleware/roles'
import { onValidationError } from '../middleware/validation'
import { sendResult } from '../util/result_response'
import { sendCreated, sendRow } from './helpers'

/**
 * Shelves are tenant-bearing via their rack (no `tenant_id` column of their
 * own): scoped callers may only mount shelves on racks inside their scope,
 * and every row answer inherits the rack's tenant for read/write gates.
 */
export const shelvesApp = new Hono()
	.use(authMiddleware)
	.get('/', vValidator('query', ShelfListQuerySchema, onValidationError), (c) => {
		const query = c.req.valid('query')
		// Shelves have no `?tenant=` param of their own; the scope still
		// applies through the rack.
		const scope = listTenantScope(c, undefined)
		if (scope instanceof Response) {
			return scope
		}
		return c.json(
			listShelves({
				search: query.search,
				page: query.page,
				limit: query.limit,
				rack: query.rack,
				sort: query.sort,
				order: query.order,
				...scope,
			}),
		)
	})
	.post(
		'/',
		requireWriteMiddleware,
		vValidator('json', ShelfCreateSchema, onValidationError),
		(c) => {
			const body = c.req.valid('json')
			// A missing rack answers 404 from the service; an out-of-scope rack
			// answers 403 here before anything is written.
			const tenant = rackTenant(body.rack_id)
			if (tenant !== undefined) {
				const denied = checkWrite(c, tenant)
				if (denied) {
					return denied
				}
			}
			return sendCreated(c, createShelf(body))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), (c) => {
		const id = c.req.valid('param').id
		const row = getShelf(id)
		if (Result.isError(row)) {
			return sendResult(c, row)
		}
		const denied = checkRead(c, shelfTenant(id) ?? null)
		if (denied) {
			return denied
		}
		return c.json(row.value)
	})
	.patch(
		'/:id',
		requireWriteMiddleware,
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', ShelfUpdateSchema, onValidationError),
		(c) => {
			const id = c.req.valid('param').id
			const body = c.req.valid('json')
			const current = getShelf(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			const denied = checkWrite(c, shelfTenant(id) ?? null)
			if (denied) {
				return denied
			}
			// Moving to another rack must not smuggle the shelf out of scope.
			if (body.rack_id !== undefined && body.rack_id !== current.value.rack_id) {
				const targetTenant = rackTenant(body.rack_id)
				if (targetTenant !== undefined) {
					const targetDenied = checkWrite(c, targetTenant)
					if (targetDenied) {
						return targetDenied
					}
				}
			}
			return sendRow(c, updateShelf(id, body))
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
			const denied = checkWrite(c, shelfTenant(id) ?? null)
			if (denied) {
				return denied
			}
			return sendRow(c, deleteShelf(id))
		},
	)
