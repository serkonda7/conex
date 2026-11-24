/**
 * Billing API wrappers (`billing.manage`): periods, lot counts, the objects
 * behind them, snapshots and the stored backup data typed in per month.
 */
import type { Result } from 'better-result'
import type {
	BillingCountJson,
	BillingItemJson,
	BillingItemsQuery,
	BillingOverviewJson,
	BillingPeriodJson,
	BillingReportJson,
	BillingStorageInput,
} from 'shared/src/types'
import { t } from '../i18n'
import { client, to_result } from './client'

export type {
	BillingCountJson,
	BillingItemJson,
	BillingOverviewJson,
	BillingPeriodJson,
	BillingReportJson,
}

const api: (typeof client)['billing'] = client.billing
const periods: (typeof api)['periods'][':period'] = api.periods[':period']

export async function fetch_billing_overview(): Promise<Result<BillingOverviewJson, Error>> {
	return to_result<BillingOverviewJson>(await api.$get(), t('billing.loadFailed'))
}

export async function fetch_billing_report(
	period: string,
): Promise<Result<BillingReportJson, Error>> {
	const res = await periods.$get({ param: { period } })
	return to_result<BillingReportJson>(res, t('billing.loadFailed'))
}

export async function fetch_billing_items(
	period: string,
	line: BillingItemsQuery,
): Promise<Result<BillingItemJson[], Error>> {
	const res = await periods.items.$get({
		param: { period },
		query: { tenant: String(line.tenant), bundle: String(line.bundle), metric: line.metric },
	})
	return to_result<BillingItemJson[]>(res, t('billing.loadFailed'))
}

export async function fetch_billing_changes(
	period: string,
): Promise<Result<BillingItemJson[], Error>> {
	const res = await periods.changes.$get({ param: { period } })
	return to_result<BillingItemJson[]>(res, t('billing.loadFailed'))
}

export async function take_billing_snapshot(
	period: string,
): Promise<Result<BillingPeriodJson, Error>> {
	const res = await periods.snapshot.$post({ param: { period } })
	return to_result<BillingPeriodJson>(res, t('billing.snapshotFailed'))
}

export async function finalize_billing_period(
	period: string,
): Promise<Result<BillingPeriodJson, Error>> {
	const res = await periods.finalize.$post({ param: { period } })
	return to_result<BillingPeriodJson>(res, t('billing.finalizeFailed'))
}

export async function save_billing_storage(
	period: string,
	input: BillingStorageInput,
): Promise<Result<BillingCountJson, Error>> {
	const res = await periods.storage.$put({ param: { period }, json: input })
	return to_result<BillingCountJson>(res, t('billing.storageFailed'))
}

/** Download URL of the period's CSV (one row per billed line). */
export function billing_export_url(period: string): string {
	return `/api/billing/periods/${encodeURIComponent(period)}/export`
}
