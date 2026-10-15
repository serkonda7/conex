/**
 * Pieces shared by the floor plan's view and edit modes: the image stage
 * with the overlay layers on top, and the display helpers of areas and
 * markers.
 */
import { IconBox, IconServer } from '@tabler/icons-solidjs'
import type { JSX } from 'solid-js'
import {
	type AttachmentJson,
	attachment_file_url,
	type FloorplanAreaJson,
	type FloorplanPlacementJson,
} from '../api/attachments'
import { t, tp } from '../i18n'
import { deviceStatusLabel } from '../i18n/labels'
import { deviceRoleIcon, type IconComponent } from '../lib/icons'

/** Percent offset of a normalized coordinate, for `left` / `top`. */
export function percent(value: number): string {
	return `${value * 100}%`
}

/** Display name of an area: its label, else its target's name. */
export function areaName(area: FloorplanAreaJson): string {
	return area.label || area.target_name
}

/** Label anchor of an area: its centroid, or the center of its bounding box when it has no area. */
export function areaCenter(area: FloorplanAreaJson): { x: number; y: number } {
	let twiceArea = 0
	let cx = 0
	let cy = 0
	area.points.forEach(([x0, y0], index) => {
		const [x1, y1] = area.points[(index + 1) % area.points.length]
		const cross = x0 * y1 - x1 * y0
		twiceArea += cross
		cx += (x0 + x1) * cross
		cy += (y0 + y1) * cross
	})
	if (Math.abs(twiceArea) > 1e-9) {
		return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) }
	}
	const xs = area.points.map((point) => point[0])
	const ys = area.points.map((point) => point[1])
	return {
		x: (Math.min(...xs) + Math.max(...xs)) / 2,
		y: (Math.min(...ys) + Math.max(...ys)) / 2,
	}
}

/** Rack glyph for racks, the role glyph for devices (a generic one without). */
export function markerIcon(
	placement: Pick<FloorplanPlacementJson, 'rack_id' | 'role_icon'>,
): IconComponent {
	if (placement.rack_id !== null) {
		return IconBox
	}
	return deviceRoleIcon(placement.role_icon) ?? IconServer
}

/** Tooltip of a marker: the name with the device status, or "Rack". */
export function markerTitle(placement: Pick<FloorplanPlacementJson, 'name' | 'status'>): string {
	const detail =
		placement.status !== null ? deviceStatusLabel(placement.status) : tp('entity.rack', 1)
	return t('floorplan.markerTitle', { name: placement.name, detail })
}

/** The image capped at 60vh high with the overlay layers (`children`) on top. */
export function FloorplanStage(props: {
	attachment: AttachmentJson
	children: JSX.Element
	/** Stage element, to map pointer positions to plan coordinates. */
	ref?: (el: HTMLDivElement) => void
	/** Extra handlers of the stage (the edit mode's drop target and deselect). */
	handlers?: JSX.HTMLAttributes<HTMLDivElement>
}): JSX.Element {
	return (
		<div class="floorplan-stage" ref={props.ref} {...props.handlers}>
			<img
				src={attachment_file_url(props.attachment)}
				alt={t('floorplan.image', {
					name: props.attachment.description || props.attachment.filename,
				})}
				width={props.attachment.width_px}
				height={props.attachment.height_px}
			/>
			{props.children}
		</div>
	)
}
