/**
 * Two-step delete for objects that may carry floor-plan data or contained
 * rows (a site's locations, a tenant's sites): the server answers the first
 * attempt with a 409 impact summary (`DeleteImpactError`); a second confirm
 * lists what goes with the object, then the delete is retried with
 * `confirm: 'contents'` or `'floorplan'`.
 */
import { Result } from 'better-result'
import type { DeleteQuery } from 'shared/src/types'
import { DeleteImpactError } from '../api/client'
import { t, tp } from '../i18n'

/** Delete call that takes the floor-plan confirmation flag. */
export type RemoveFn = (id: number, opts?: DeleteQuery) => Promise<Result<unknown, Error>>

/** Second confirm: names the contents and floor-plan data that would be deleted too. */
function confirmImpact(name: string, error: DeleteImpactError): boolean {
	const { areas, placements, linkedFrom, drawings } = error.floorplan
	const contents = error.contents
	const parts = [
		contents && contents.sites > 0 ? tp('delete.siteCount', contents.sites) : null,
		contents && contents.site_groups > 0
			? tp('delete.siteGroupCount', contents.site_groups)
			: null,
		contents && contents.locations > 0 ? tp('delete.locationCount', contents.locations) : null,
		areas > 0 ? tp('floorplan.areaCount', areas) : null,
		placements > 0 ? tp('floorplan.markerCount', placements) : null,
		linkedFrom > 0 ? tp('floorplan.linkedCount', linkedFrom) : null,
		drawings > 0 ? t('drawnPlan.impact') : null,
	].filter((part) => part !== null)
	const key = contents ? 'delete.confirmContents' : 'floorplan.confirmDelete'
	return window.confirm(t(key, { name, impact: parts.join(', ') }))
}

/**
 * Runs `remove(id)`; on an impact 409 asks the second confirm and retries
 * with the matching flag. `ok(false)` when the user declined that second step.
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
	if (!(res.error instanceof DeleteImpactError)) {
		return Result.err(res.error)
	}
	if (!confirmImpact(name, res.error)) {
		return Result.ok(false)
	}
	const confirm = res.error.contents ? 'contents' : 'floorplan'
	const retried = await remove(id, { confirm })
	return Result.isOk(retried) ? Result.ok(true) : Result.err(retried.error)
}
