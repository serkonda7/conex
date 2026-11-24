/**
 * Symbolic device images: lays out the ports of one panel face (front or
 * rear) of a device on a 19" faceplate. Pure geometry in millimetres, so the
 * client renders it as SVG and tests check it without a DOM. Shapes and sizes
 * are symbolic, close to the real connectors so a faceplate reads plausibly.
 */
import type { PanelFace, PortSide } from '@serkonda7/conex-device-schema'

/** Outer width of a 19" faceplate including the rack ears. */
export const RACK_WIDTH_MM = 482.6
/** Height of one rack unit. */
export const RACK_UNIT_MM = 44.45
/** Width of one rack ear (mounting flange with the screw holes). */
export const RACK_EAR_MM = 16
/** Clearance between the panel edge and the ports. */
const PANEL_PAD_MM = 3.5
/** Gap between the ports of one group. */
const PORT_GAP_X_MM = 1.4
const PORT_GAP_Y_MM = 1.8
/** Gap between two port groups. */
const GROUP_GAP_MM = 7
/** Label width: what the ports leave, within these bounds. */
const LABEL_MIN_MM = 30
const LABEL_MAX_MM = 64
/** Interfaces of a run this long start in two rows, as on a switch. */
const TWO_ROW_RUN = 12

/** Connector drawings of the faceplate renderer. */
export const PORT_SHAPES = [
	'rj45',
	'rj11',
	'sfp',
	'qsfp',
	'usb-a',
	'usb-b',
	'usb-c',
	'usb-mini',
	'd-sub',
	'd-sub-wide',
	'hdmi',
	'displayport',
	'round',
	'iec-inlet',
	'iec-inlet-large',
	'iec-small',
	'outlet',
	'outlet-large',
	'schuko',
	'terminal',
	'lc',
	'sc',
	'mpo',
	'punch',
	'generic',
] as const

export type PortShape = (typeof PORT_SHAPES)[number]

/** Width and height of each shape in mm. */
export const PORT_SHAPE_SIZES: Record<PortShape, { w: number; h: number }> = {
	rj45: { w: 13, h: 11.5 },
	rj11: { w: 10, h: 8.5 },
	sfp: { w: 14, h: 9.5 },
	qsfp: { w: 19, h: 9.5 },
	'usb-a': { w: 13, h: 5.8 },
	'usb-b': { w: 8.5, h: 7.5 },
	'usb-c': { w: 9, h: 3.6 },
	'usb-mini': { w: 7.5, h: 3.6 },
	'd-sub': { w: 17, h: 8.5 },
	'd-sub-wide': { w: 30, h: 9 },
	hdmi: { w: 14.5, h: 5.2 },
	displayport: { w: 16, h: 6 },
	round: { w: 9.5, h: 9.5 },
	'iec-inlet': { w: 24, h: 18 },
	'iec-inlet-large': { w: 28, h: 21 },
	'iec-small': { w: 13, h: 8 },
	outlet: { w: 22, h: 17 },
	'outlet-large': { w: 26, h: 20 },
	schuko: { w: 36, h: 36 },
	terminal: { w: 15, h: 8 },
	lc: { w: 7, h: 9 },
	sc: { w: 9.5, h: 10 },
	mpo: { w: 12, h: 7.5 },
	punch: { w: 13, h: 6 },
	generic: { w: 10, h: 8 },
}

/** Shapes that sit right-aligned on a panel, as power inlets usually do. */
const POWER_SHAPES = new Set<PortShape>([
	'iec-inlet',
	'iec-inlet-large',
	'iec-small',
	'outlet',
	'outlet-large',
	'schuko',
	'terminal',
])

const EXACT_SHAPES: Record<string, PortShape> = {
	ethernet: 'rj45',
	'rj-45': 'rj45',
	'rj-11': 'rj11',
	'rj-12': 'rj11',
	'de-9': 'd-sub',
	vga: 'd-sub',
	'db-25': 'd-sub-wide',
	dvi: 'd-sub-wide',
	'mini-din-8': 'round',
	'usb-a': 'usb-a',
	'power-outlet-usb-a': 'usb-a',
	'usb-b': 'usb-b',
	'usb-c': 'usb-c',
	'power-usb-c': 'usb-c',
	'power-outlet-usb-c': 'usb-c',
	hdmi: 'hdmi',
	displayport: 'displayport',
	power: 'iec-inlet',
	'power-iec-60320-c14': 'iec-inlet',
	'power-iec-60320-c20': 'iec-inlet-large',
	'power-iec-60320-c8': 'iec-small',
	'power-iec-60320-c6': 'iec-small',
	'power-ita-ef': 'round',
	'power-dc-barrel': 'round',
	'power-dc-terminal': 'terminal',
	'power-outlet-dc-terminal': 'terminal',
	'power-outlet': 'schuko',
	'power-outlet-ita-f': 'schuko',
	'power-outlet-iec-60320-c13': 'outlet',
	'power-outlet-iec-60320-c19': 'outlet-large',
	'power-outlet-iec-60320-c7': 'iec-small',
	'power-outlet-iec-60320-c5': 'iec-small',
	lc: 'lc',
	'lc-apc': 'lc',
	mtrj: 'lc',
	sc: 'sc',
	'sc-apc': 'sc',
	st: 'round',
	fc: 'round',
	mpo: 'mpo',
	'110-punch': 'punch',
	splice: 'generic',
	port: 'generic',
	other: 'generic',
}

/** Interface kinds without a socket on the panel: logical or radio. */
function isUndrawn(kind: string): boolean {
	return (
		kind === 'virtual' ||
		kind === 'bridge' ||
		kind === 'lag' ||
		kind.startsWith('ieee802.1') ||
		['lte', '5g', '4g', '3g', 'gsm', 'cdma'].includes(kind)
	)
}

/**
 * Connector drawing of a port, or null for ports without a socket (virtual,
 * LAG, Wi-Fi, cellular). Rear copper ports of a patch panel are punch-down
 * terminals; unknown kinds draw as a generic socket.
 */
export function portShape(kind: string, side: PortSide | null): PortShape | null {
	if (side === 'rear' && kind === '8p8c') {
		return 'punch'
	}
	if (kind === '8p8c') {
		return 'rj45'
	}
	const exact = EXACT_SHAPES[kind]
	if (exact !== undefined) {
		return exact
	}
	if (isUndrawn(kind)) {
		return null
	}
	if (kind.startsWith('usb-mini') || kind.startsWith('usb-micro')) {
		return 'usb-mini'
	}
	if (kind.includes('qsfp') || kind.includes('osfp') || kind.includes('cfp')) {
		return 'qsfp'
	}
	if (kind.includes('sfp') || kind.includes('base-x') || kind.includes('gbic')) {
		return 'sfp'
	}
	if (kind.includes('base-t') || kind.includes('base-tx')) {
		return 'rj45'
	}
	return 'generic'
}

/**
 * The panel face a port sits on: its own face when set, else rear for rear
 * pass-through ports, power inputs and outlets, front for everything else.
 */
export function portFace(port: {
	kind: string
	side: PortSide | null
	face?: PanelFace | null
}): PanelFace {
	if (port.face) {
		return port.face
	}
	if (port.side !== null) {
		return port.side
	}
	return port.kind === 'power' || port.kind.startsWith('power-') ? 'rear' : 'front'
}

/** A port to place; `group` keeps ports of one stub together. */
export interface FaceplatePort {
	name: string
	kind: string
	side: PortSide | null
	face?: PanelFace | null
	/** Ports with the same group sit in one block; unset groups by name and kind. */
	group?: string | number
}

/** A placed port: `index` into the input ports, box in mm. */
export interface FaceplateCell {
	index: number
	shape: PortShape
	x: number
	y: number
	w: number
	h: number
}

export interface FaceplateBox {
	x: number
	y: number
	w: number
	h: number
}

export interface FaceplateLayout {
	width: number
	height: number
	/** Rack-mounted (with ears); devices of 0 U are drawn as a plain box. */
	rack: boolean
	/** Panel between the ears. */
	panel: FaceplateBox
	/** Where the label goes, or null when the ports need the room. */
	label: FaceplateBox | null
	cells: FaceplateCell[]
	/** Ports of this face that have no socket to draw (virtual, Wi-Fi). */
	undrawn: number
}

interface Group {
	shape: PortShape
	indexes: number[]
	/** Patch-panel ports number row by row, interfaces column by column. */
	rowMajor: boolean
	rows: number
	maxRows: number
}

/** Name without its trailing number: `eth12` -> `eth`, `Port 07` -> `Port `. */
function namePrefix(name: string): string {
	return name.replace(/\d+$/, '')
}

function groupKey(port: FaceplatePort, shape: PortShape): string {
	return port.group === undefined
		? `${shape}|${port.kind}|${port.side ?? ''}|${namePrefix(port.name)}`
		: `group|${port.group}`
}

function columns(group: Group, rows: number): number {
	return Math.ceil(group.indexes.length / rows)
}

function groupWidth(group: Group, rows = group.rows): number {
	const { w } = PORT_SHAPE_SIZES[group.shape]
	const cols = columns(group, rows)
	return cols * w + (cols - 1) * PORT_GAP_X_MM
}

function totalWidth(groups: Group[]): number {
	return (
		groups.reduce((sum, group) => sum + groupWidth(group), 0) +
		Math.max(0, groups.length - 1) * GROUP_GAP_MM
	)
}

/** Consecutive ports of one face that belong together, in input order. */
function groupsOf(
	ports: readonly FaceplatePort[],
	face: PanelFace,
	height: number,
): { groups: Group[]; undrawn: number } {
	const groups: Group[] = []
	let undrawn = 0
	let lastKey: string | null = null
	for (const [index, port] of ports.entries()) {
		if (portFace(port) !== face) {
			continue
		}
		const shape = portShape(port.kind, port.side)
		if (shape === null) {
			undrawn += 1
			continue
		}
		const key = groupKey(port, shape)
		const last = groups.at(-1)
		if (last && key === lastKey && last.shape === shape) {
			last.indexes.push(index)
			continue
		}
		const { h } = PORT_SHAPE_SIZES[shape]
		groups.push({
			shape,
			indexes: [index],
			rowMajor: port.side !== null,
			rows: 1,
			maxRows: Math.max(1, Math.floor((height + PORT_GAP_Y_MM) / (h + PORT_GAP_Y_MM))),
		})
		lastKey = key
	}
	return { groups, undrawn }
}

/**
 * Picks the rows of each group: long interface runs start in two rows like a
 * switch, then the widest group that can still fold gets another row until
 * everything fits. Answers the total width.
 */
function foldRows(groups: Group[], available: number): number {
	for (const group of groups) {
		group.rows =
			!group.rowMajor && group.indexes.length >= TWO_ROW_RUN ? Math.min(2, group.maxRows) : 1
	}
	let total = totalWidth(groups)
	while (total > available) {
		const foldable = groups
			.filter((g) => g.rows < g.maxRows && columns(g, g.rows + 1) < columns(g, g.rows))
			.sort((a, b) => groupWidth(b) - groupWidth(a))
		const widest = foldable[0]
		if (!widest) {
			break
		}
		widest.rows += 1
		total = totalWidth(groups)
	}
	return total
}

/**
 * Places the ports of `face`: groups left to right after the label, power
 * groups right-aligned, each group vertically centred. What still doesn't
 * fit scales down as a whole.
 */
export function layoutFaceplate(
	ports: readonly FaceplatePort[],
	face: PanelFace,
	options: { u_height: number; label?: boolean },
): FaceplateLayout {
	const rack = options.u_height > 0
	const width = RACK_WIDTH_MM
	const height = Math.max(1, options.u_height) * RACK_UNIT_MM
	const ear = rack ? RACK_EAR_MM : 0
	const panel: FaceplateBox = { x: ear, y: 0, w: width - 2 * ear, h: height }
	const inner: FaceplateBox = {
		x: panel.x + PANEL_PAD_MM,
		y: PANEL_PAD_MM,
		w: panel.w - 2 * PANEL_PAD_MM,
		h: height - 2 * PANEL_PAD_MM,
	}
	const { groups, undrawn } = groupsOf(ports, face, inner.h)
	// The label takes what the ports leave; the ports matter more, so
	// it goes before they shrink.
	let label: FaceplateBox | null = null
	let available = inner.w
	let total: number
	if (options.label) {
		total = foldRows(groups, inner.w - LABEL_MIN_MM - GROUP_GAP_MM)
		const room = inner.w - total - (groups.length > 0 ? GROUP_GAP_MM : 0)
		if (room >= LABEL_MIN_MM) {
			const w = Math.min(LABEL_MAX_MM, room)
			label = { x: inner.x, y: inner.y, w, h: inner.h }
			available = inner.w - w - GROUP_GAP_MM
		} else {
			total = foldRows(groups, available)
		}
	} else {
		total = foldRows(groups, available)
	}
	const scale = total > available ? available / total : 1
	const cells: FaceplateCell[] = []
	const start = label ? label.x + label.w + GROUP_GAP_MM : inner.x
	let left = start
	let right = inner.x + inner.w
	const ordered = [
		...groups.filter((g) => !POWER_SHAPES.has(g.shape)),
		...groups.filter((g) => POWER_SHAPES.has(g.shape)).reverse(),
	]
	for (const group of ordered) {
		const size = PORT_SHAPE_SIZES[group.shape]
		const w = size.w * scale
		const h = size.h * scale
		const gapX = PORT_GAP_X_MM * scale
		const gapY = PORT_GAP_Y_MM * scale
		const cols = columns(group, group.rows)
		const rows = Math.min(group.rows, group.indexes.length)
		const blockW = groupWidth(group) * scale
		const blockH = rows * h + (rows - 1) * gapY
		const power = POWER_SHAPES.has(group.shape)
		const x0 = power ? right - blockW : left
		const y0 = inner.y + (inner.h - blockH) / 2
		for (const [i, index] of group.indexes.entries()) {
			const col = group.rowMajor ? i % cols : Math.floor(i / rows)
			const row = group.rowMajor ? Math.floor(i / cols) : i % rows
			cells.push({
				index,
				shape: group.shape,
				x: x0 + col * (w + gapX),
				y: y0 + row * (h + gapY),
				w,
				h,
			})
		}
		if (power) {
			right -= blockW + GROUP_GAP_MM * scale
		} else {
			left += blockW + GROUP_GAP_MM * scale
		}
	}
	return { width, height, rack, panel, label, cells, undrawn }
}
