/**
 * Blocked U range of a shelf: the mount span counts unless `mount_usable`
 * is set; the reserved span always counts. Returns null when nothing is
 * blocked (mount usable with no reserve).
 */
export function shelfBlockedRange(shelf: {
	position_u: number
	mount_height: number
	mount_usable: boolean
	reserved_height: number
}): { position_u: number; height_u: number } | null {
	const total = shelf.mount_height + shelf.reserved_height
	if (shelf.mount_usable) {
		if (shelf.reserved_height <= 0) {
			return null
		}
		return {
			position_u: shelf.position_u + shelf.mount_height,
			height_u: shelf.reserved_height,
		}
	}
	if (total <= 0) {
		return null
	}
	return { position_u: shelf.position_u, height_u: total }
}
