/**
 * Deep links into a floor plan: `/floorplans/5?rack=3` opens plan 5 with the
 * rack's marker selected and zoomed to. The keys are those of
 * `FloorplanLinkTarget` plus `jack`; `site` and `location` point at an area.
 */
import type { FloorplanLinkTarget } from '../api/attachments'

export const FLOORPLAN_LINK_KEYS = [
	'rack',
	'device',
	'interface',
	'jack',
	'site',
	'location',
] as const

export type FloorplanLinkKey = (typeof FLOORPLAN_LINK_KEYS)[number]

/** Link to the plan of `attachmentId`, focused on `focus` when given. */
export function floorplanHref(
	attachmentId: number,
	focus?: FloorplanLinkTarget | { jack: number },
): string {
	const entry = focus ? Object.entries(focus)[0] : undefined
	return entry
		? `/floorplans/${attachmentId}?${entry[0]}=${entry[1]}`
		: `/floorplans/${attachmentId}`
}
