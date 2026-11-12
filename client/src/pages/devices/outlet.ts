import type { InterfaceJson } from '../../api/devices'

/** Outlet: a single-position rear port (a multi-position one is a trunk). */
export const isOutlet = (iface: InterfaceJson): boolean =>
	iface.side === 'rear' && iface.positions === 1
