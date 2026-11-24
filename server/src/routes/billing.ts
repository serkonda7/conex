import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	BillingItemsQuerySchema,
	BillingPeriodParamsSchema,
	BillingStorageInputSchema,
} from 'shared/src/schemas'
import { requestUser } from '../authz'
import {
	exportBillingCsv,
	finalizeBillingPeriod,
	getBillingChanges,
	getBillingItems,
	getBillingOverview,
	getBillingReport,
	setBillingStorage,
	takeBillingSnapshot,
} from '../billing/store'
import { authMiddleware } from '../middleware/auth'
import { requireGlobalPermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCsv } from '../util/http'
import { sendResult } from '../util/result_response'

/**
 * Monthly lot counts of the managed bundles (`billing.manage`, global
 * accounts only: the counts span every tenant).
 */
export const billingApp = new Hono()
	.use(authMiddleware)
	.use(requireGlobalPermissionMiddleware('billing.manage'))
	.get('/', async (c) => sendResult(c, await getBillingOverview()))
	.get(
		'/periods/:period',
		vValidator('param', BillingPeriodParamsSchema, onValidationError),
		async (c) => sendResult(c, await getBillingReport(c.req.valid('param').period)),
	)
	.get(
		'/periods/:period/items',
		vValidator('param', BillingPeriodParamsSchema, onValidationError),
		vValidator('query', BillingItemsQuerySchema, onValidationError),
		async (c) =>
			sendResult(c, await getBillingItems(c.req.valid('param').period, c.req.valid('query'))),
	)
	.get(
		'/periods/:period/changes',
		vValidator('param', BillingPeriodParamsSchema, onValidationError),
		async (c) => sendResult(c, await getBillingChanges(c.req.valid('param').period)),
	)
	.get(
		'/periods/:period/export',
		vValidator('param', BillingPeriodParamsSchema, onValidationError),
		async (c) => {
			const { period } = c.req.valid('param')
			const csv = await exportBillingCsv(period)
			return Result.isOk(csv)
				? sendCsv(c, csv.value, `lots-${period}.csv`)
				: sendResult(c, csv)
		},
	)
	.post(
		'/periods/:period/snapshot',
		vValidator('param', BillingPeriodParamsSchema, onValidationError),
		async (c) =>
			sendResult(
				c,
				await takeBillingSnapshot(c.req.valid('param').period, requestUser(c).username),
			),
	)
	.post(
		'/periods/:period/finalize',
		vValidator('param', BillingPeriodParamsSchema, onValidationError),
		async (c) =>
			sendResult(
				c,
				await finalizeBillingPeriod(c.req.valid('param').period, requestUser(c).username),
			),
	)
	.put(
		'/periods/:period/storage',
		vValidator('param', BillingPeriodParamsSchema, onValidationError),
		vValidator('json', BillingStorageInputSchema, onValidationError),
		async (c) =>
			sendResult(
				c,
				await setBillingStorage(
					c.req.valid('param').period,
					c.req.valid('json'),
					requestUser(c).username,
				),
			),
	)
