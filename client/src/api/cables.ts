/**
 * Cables API wrappers: typed cables/trace calls over the hono RPC client.
 * Errors surface as `Result.err` with the server's `{ error }` message.
 */
import type { Result } from 'better-result'
import type { CableRow } from 'server/src/db/cables'
import type {
	CableCreate,
	CableStatus,
	DeviceTraceResponse,
	InterfaceTraceResponse,
} from 'shared/src/types'
import { t } from '../i18n'
import { by_id, client, failed, to_query, to_result } from './client'

export type { CableRow, DeviceTraceResponse, InterfaceTraceResponse }

/**
 * Cable create body. `status` stays optional here even though the shared
 * output type marks it required: the server defaults it to `connected`.
 */
export type CableCreateInput = Omit<CableCreate, 'status'> & {
	status?: CableStatus
}

export async function create_cable(input: CableCreateInput): Promise<Result<CableRow, Error>> {
	const res = await client.cables.$post({ json: input })
	return to_result<CableRow>(res, failed.create('noun.cable'))
}

export async function delete_cable(id: number): Promise<Result<unknown, Error>> {
	const res = await client.cables[':id'].$delete(by_id(id))
	return to_result<unknown>(res, failed.delete('noun.cable'))
}

export async function fetch_trace(
	deviceId: number,
	depth?: number,
): Promise<Result<DeviceTraceResponse, Error>> {
	const res = await client.devices[':id'].trace.$get({
		...by_id(deviceId),
		query: to_query({ depth }),
	})
	return to_result<DeviceTraceResponse>(res, t('api.loadTraceFailed'))
}

/** Trace from one port: its paths and, behind patch panels, its end-to-end peers. */
export async function fetch_interface_trace(
	deviceId: number,
	ifaceId: number,
	depth?: number,
): Promise<Result<InterfaceTraceResponse, Error>> {
	const res = await client.devices[':id'].interfaces[':ifaceId'].trace.$get({
		param: { id: String(deviceId), ifaceId: String(ifaceId) },
		query: to_query({ depth }),
	})
	return to_result<InterfaceTraceResponse>(res, t('api.loadTraceFailed'))
}
