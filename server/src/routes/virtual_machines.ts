import { vValidator } from '@hono/valibot-validator'
import { Result } from 'better-result'
import { Hono } from 'hono'
import {
	EntityParamsSchema,
	VirtualMachineCreateSchema,
	VirtualMachineUpdateSchema,
} from 'shared/src/schemas'
import { checkTenant, checkUpdateTenant, resolveCreateTenant, sendTenantRow } from '../authz'
import { deviceTenant } from '../db/owners'
import {
	createVirtualMachine,
	deleteVirtualMachine,
	getVirtualMachine,
	updateVirtualMachine,
} from '../db/virtual_machines'
import { authMiddleware } from '../middleware/auth'
import { requirePermissionMiddleware } from '../middleware/permissions'
import { onValidationError } from '../middleware/validation'
import { sendCreated, sendResult } from '../util/result_response'

/**
 * Virtual machines are tenant-bearing like devices. A hosted VM takes its
 * tenant from the host, so writes onto a host are gated by the host's
 * tenant; only hostless VMs resolve the body tenant against the scope.
 * Listing goes through `GET /api/devices` (devices and VMs in one list).
 */
export const virtualMachinesApp = new Hono()
	.use(authMiddleware)
	.use(requirePermissionMiddleware('view'))
	.post(
		'/',
		requirePermissionMiddleware('edit'),
		vValidator('json', VirtualMachineCreateSchema, onValidationError),
		async (c) => {
			const body = c.req.valid('json')
			if (body.host_device_id !== undefined && body.host_device_id !== null) {
				return (
					checkTenant(c, await deviceTenant(body.host_device_id)) ??
					sendCreated(c, await createVirtualMachine(body))
				)
			}
			const tenant = resolveCreateTenant(c, body.tenant_id)
			if (tenant instanceof Response) {
				return tenant
			}
			return sendCreated(c, await createVirtualMachine({ ...body, tenant_id: tenant }))
		},
	)
	.get('/:id', vValidator('param', EntityParamsSchema, onValidationError), async (c) => {
		return sendTenantRow(c, await getVirtualMachine(c.req.valid('param').id))
	})
	.patch(
		'/:id',
		requirePermissionMiddleware('edit'),
		vValidator('param', EntityParamsSchema, onValidationError),
		vValidator('json', VirtualMachineUpdateSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const body = c.req.valid('json')
			const current = await getVirtualMachine(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			const denied =
				checkUpdateTenant(c, current.value.tenant_id, body.tenant_id) ??
				(body.host_device_id !== undefined && body.host_device_id !== null
					? checkTenant(c, await deviceTenant(body.host_device_id))
					: null)
			return denied ?? sendResult(c, await updateVirtualMachine(id, body))
		},
	)
	.delete(
		'/:id',
		requirePermissionMiddleware('delete'),
		vValidator('param', EntityParamsSchema, onValidationError),
		async (c) => {
			const id = c.req.valid('param').id
			const current = await getVirtualMachine(id)
			if (Result.isError(current)) {
				return sendResult(c, current)
			}
			return (
				checkTenant(c, current.value.tenant_id) ??
				sendResult(c, await deleteVirtualMachine(id))
			)
		},
	)
