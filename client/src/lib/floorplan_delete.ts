/**
 * Two-step delete for objects that may carry floor-plan data: the server
 * answers the first attempt with a 409 impact summary (`FloorplanImpactError`);
 * a second confirm lists what goes with the object, then the delete is
 * retried with `confirm: 'floorplan'`.
 */
import { Result } from 'better-result'
import type { DeleteQuery } from 'shared/src/types'
import { FloorplanImpactError } from '../api/client'
import { t, tp } from '../i18n'

/** Delete call that takes the floor-plan confirmation flag. */
export type RemoveFn = (id: number, opts?: DeleteQuery) => Promise<Result<unknown, Error>>

/** Second confirm: names the floor-plan data that would be deleted too. */
function confirmImpact(name: string, error: FloorplanImpactError): boolean {
	const { areas, placements, linkedFrom } = error.floorplan
	const parts = [
		areas > 0 ? tp('floorplan.areaCount', areas) : null,
		placements > 0 ? tp('floorplan.markerCount', placements) : null,
		linkedFrom > 0 ? tp('floorplan.linkedCount', linkedFrom) : null,
	].filter((part) => part !== null)
	return window.confirm(t('floorplan.confirmDelete', { name, impact: parts.join(', ') }))
}

/**
 * Runs `remove(id)`; on a floor-plan 409 asks the second confirm and retries
 * with the flag. `ok(false)` when the user declined that second step.
 */
export async function removeConfirmingFloorplan(
	remove: RemoveFn,
	id: number,
	name: string,
): Promise<Result<boolean, Error>> {
	const res = await remove(id)
	if (Result.isOk(res)) {
		return Result.ok(true)
	}
	if (!(res.error instanceof FloorplanImpactError)) {
		return Result.err(res.error)
	}
	if (!confirmImpact(name, res.error)) {
		return Result.ok(false)
	}
	const retried = await remove(id, { confirm: 'floorplan' })
	return Result.isOk(retried) ? Result.ok(true) : Result.err(retried.error)
}
