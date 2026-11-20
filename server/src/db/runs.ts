import { eq } from 'drizzle-orm'
import type { calendar_sync_runs, sync_runs } from '../schema'
import { nowSeconds } from '../util/time'
import { getDb } from './connection'

/**
 * Marks runs interrupted by a server restart as failed. Called once at
 * startup for both run tables; only rows still `running` are affected.
 */
export async function failInterruptedRuns(
	table: typeof sync_runs | typeof calendar_sync_runs,
): Promise<void> {
	await getDb()
		.update(table)
		.set({ state: 'error', finished_at: nowSeconds(), error: 'Interrupted by server restart' })
		.where(eq(table.state, 'running'))
}
