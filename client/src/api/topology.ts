/**
 * Topology + cable-trace API wrappers: typed graph/trace calls over the
 * hono RPC client. Errors surface as `Result.err` with the server's
 * `{ error }` message.
 */
import type { Result } from 'better-result'
import type { CableTraceResponse, TopologyQuery, TopologyResponse } from 'shared/src/types'
import { t } from '../i18n'
import { by_id, client, to_query, to_result } from './client'

export type { CableTraceResponse, TopologyResponse }

export async function fetch_topology(
	filters?: Partial<TopologyQuery>,
): Promise<Result<TopologyResponse, Error>> {
	const res = await client.topology.$get({
		query: to_query({
			group: filters?.group,
			site: filters?.site,
			device: filters?.device,
			tenant: filters?.tenant,
			tenant_group: filters?.tenant_group,
		}),
	})
	return to_result<TopologyResponse>(res, t('api.loadTopologyFailed'))
}

export async function fetch_cable_trace(
	cableId: number,
	depth?: number,
): Promise<Result<CableTraceResponse, Error>> {
	const res = await client.cables[':id'].trace.$get({
		...by_id(cableId),
		query: to_query({ depth }),
	})
	return to_result<CableTraceResponse>(res, t('api.loadCableTraceFailed'))
}
