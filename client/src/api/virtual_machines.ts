/**
 * Virtual machine API wrappers: typed virtual-machines calls over the hono
 * RPC client. Listing goes through `fetch_device_list` (devices and VMs in
 * one list). Errors surface as `Result.err` with the server's `{ error }`
 * message.
 */
import type { Result } from 'better-result'
import type { VirtualMachineRow } from 'server/src/db/virtual_machines'
import type {
	DeviceServiceJson,
	DeviceStatus,
	VirtualMachineCreate,
	VirtualMachineUpdate,
} from 'shared/src/types'
import { by_id, client, failed, to_result } from './client'

export type { VirtualMachineRow }

export async function fetch_virtual_machine(id: number): Promise<Result<VirtualMachineRow, Error>> {
	const res = await client['virtual-machines'][':id'].$get(by_id(id))
	return to_result<VirtualMachineRow>(res, failed.load('noun.virtualMachine'))
}

/** Managed bundle of a VM (via its role) and its tenant's SLA for it. */
export async function fetch_virtual_machine_service(
	id: number,
): Promise<Result<DeviceServiceJson, Error>> {
	const res = await client['virtual-machines'][':id'].service.$get(by_id(id))
	return to_result<DeviceServiceJson>(res, failed.load('noun.serviceLevel'))
}

/**
 * VM create body. `status` stays optional here even though the shared
 * output type marks it required: the server defaults it to `active`.
 */
export type VirtualMachineCreateInput = Omit<VirtualMachineCreate, 'status'> & {
	status?: DeviceStatus
}

export async function create_virtual_machine(
	input: VirtualMachineCreateInput,
): Promise<Result<VirtualMachineRow, Error>> {
	const res = await client['virtual-machines'].$post({ json: input })
	return to_result<VirtualMachineRow>(res, failed.create('noun.virtualMachine'))
}

export async function update_virtual_machine(
	id: number,
	patch: VirtualMachineUpdate,
): Promise<Result<VirtualMachineRow, Error>> {
	const res = await client['virtual-machines'][':id'].$patch({ ...by_id(id), json: patch })
	return to_result<VirtualMachineRow>(res, failed.update('noun.virtualMachine'))
}

export async function delete_virtual_machine(id: number): Promise<Result<unknown, Error>> {
	const res = await client['virtual-machines'][':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.virtualMachine'))
}
