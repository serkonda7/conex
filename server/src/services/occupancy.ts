import { Result } from 'better-result'
import { ConflictError } from '../db/errors'

/**
 * Pure U-occupancy helpers for racks. They operate on in-memory spans so the
 * bounds/overlap guards are unit-testable without a database; `db/racks.ts`
 * loads the rows and delegates the math here.
 *
 * U positions are bottom-U, 1-based: a span occupies
 * `position_u..position_u+height_u-1`. Device spans are accepted by the same
 * helpers (P4 fills them); v1 callers pass shelves only.
 */

export interface OccupantSpan {
	id: number
	name: string
	position_u: number
	height_u: number
}

export interface ElevationUnit {
	u: number
	shelf: { id: number; name: string } | null
	device: { id: number; name: string } | null
}

export interface OccupancyMap {
	height_u: number
	/** Bottom-up: U 1 first. The elevation endpoint reverses this for display. */
	units: ElevationUnit[]
}

/** Inclusive `[first, last]` U range of a span. */
export function spanRange(span: Pick<OccupantSpan, 'position_u' | 'height_u'>): [number, number] {
	return [span.position_u, span.position_u + span.height_u - 1]
}

/** True when two inclusive U ranges share at least one U. */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
	return a[0] <= b[1] && b[0] <= a[1]
}

/**
 * Rejects a span that sticks out of the rack (`position_u < 1` or the top
 * above `rackHeight`). Pure range check, no store access.
 */
export function checkBounds(
	span: Pick<OccupantSpan, 'position_u' | 'height_u'>,
	rackHeight: number,
	label: string,
): Result<undefined, Error> {
	const [first, last] = spanRange(span)
	if (first < 1 || last > rackHeight) {
		return Result.err(
			new ConflictError(
				`${label} occupies U${first}..U${last}, outside the 1..${rackHeight} range of the rack`,
			),
		)
	}
	return Result.ok(undefined)
}

/**
 * Rejects a span whose U range overlaps an existing one. `excludeId` skips
 * the span being updated so a no-op move is not self-conflicting.
 */
export function checkOverlap(
	candidate: OccupantSpan,
	existing: OccupantSpan[],
	label: string,
	excludeId?: number,
): Result<undefined, Error> {
	const range = spanRange(candidate)
	for (const other of existing) {
		if (other.id === excludeId || other.id === candidate.id) {
			continue
		}
		if (rangesOverlap(range, spanRange(other))) {
			const [first, last] = range
			return Result.err(
				new ConflictError(
					`${label} at U${first}..U${last} overlaps "${other.name}" at U${other.position_u}..U${other.position_u + other.height_u - 1}`,
				),
			)
		}
	}
	return Result.ok(undefined)
}

/**
 * Builds the per-U occupancy map of a rack. Errs on any out-of-bounds or
 * overlapping shelf/device span so a corrupt store can never render as a
 * silently overlapping elevation.
 */
export function getOccupancy(
	rackHeight: number,
	shelves: OccupantSpan[],
	devices: OccupantSpan[] = [],
): Result<OccupancyMap, Error> {
	for (const shelf of shelves) {
		const bounds = checkBounds(shelf, rackHeight, `Shelf "${shelf.name}"`)
		if (Result.isError(bounds)) {
			return Result.err(bounds.error)
		}
	}
	for (const device of devices) {
		const bounds = checkBounds(device, rackHeight, `Device "${device.name}"`)
		if (Result.isError(bounds)) {
			return Result.err(bounds.error)
		}
	}
	const seen: OccupantSpan[] = []
	for (const shelf of shelves) {
		const overlap = checkOverlap(shelf, seen, `Shelf "${shelf.name}"`)
		if (Result.isError(overlap)) {
			return Result.err(overlap.error)
		}
		seen.push(shelf)
	}
	for (const device of devices) {
		const overlap = checkOverlap(device, seen, `Device "${device.name}"`)
		if (Result.isError(overlap)) {
			return Result.err(overlap.error)
		}
		seen.push(device)
	}

	const shelfByU = new Map<number, { id: number; name: string }>()
	for (const shelf of shelves) {
		const [first, last] = spanRange(shelf)
		for (let u = first; u <= last; u += 1) {
			shelfByU.set(u, { id: shelf.id, name: shelf.name })
		}
	}
	const deviceByU = new Map<number, { id: number; name: string }>()
	for (const device of devices) {
		const [first, last] = spanRange(device)
		for (let u = first; u <= last; u += 1) {
			deviceByU.set(u, { id: device.id, name: device.name })
		}
	}

	const units: ElevationUnit[] = []
	for (let u = 1; u <= rackHeight; u += 1) {
		units.push({ u, shelf: shelfByU.get(u) ?? null, device: deviceByU.get(u) ?? null })
	}
	return Result.ok({ height_u: rackHeight, units })
}
