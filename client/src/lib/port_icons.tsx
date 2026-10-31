import type { JSX } from 'solid-js'
import type { IconComponent } from './icons'

function PortSvg(props: { size?: number; children: JSX.Element }): JSX.Element {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={props.size ?? 24}
			height={props.size ?? 24}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{props.children}
		</svg>
	)
}

/** RJ-45 jack seen from the front: latch notch below, contact pins above. */
export const IconRj45: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M4 4h16v11h-3v4H7v-4H4z" />
		<path d="M8 4v4M12 4v4M16 4v4" />
	</PortSvg>
)

/** Duplex LC fiber port seen from the front: housing with two ferrules. */
export const IconFiber: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<circle cx="8.5" cy="12" r="2.5" />
		<circle cx="15.5" cy="12" r="2.5" />
		<path d="M8.5 12h.01M15.5 12h.01" />
	</PortSvg>
)

/** USB-A socket: wide shell, contact tongue in its upper half. */
export const IconUsbA: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<rect x="2" y="7" width="20" height="10" rx="1" />
		<path d="M6 10.5h12" />
	</PortSvg>
)

/** USB-B socket: square shell with chamfered top corners around a central tongue. */
export const IconUsbB: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M5 20V9l4-5h6l4 5v11z" />
		<rect x="9.5" y="10" width="5" height="6" fill="currentColor" stroke="none" />
	</PortSvg>
)

/** USB-C socket: stadium shell around a central tongue. */
export const IconUsbC: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<rect x="2" y="7.5" width="20" height="9" rx="4.5" />
		<path d="M7.5 12h9" />
	</PortSvg>
)

/** Mini-A socket: flat top, rounded lower corners. */
export const IconUsbMiniA: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M3 7h18v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
		<path d="M7 11h10" />
	</PortSvg>
)

/** Mini-B socket: wide top with stepped, tapering sides. */
export const IconUsbMiniB: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M3 7h18v4h-2v3l-3 3H8l-3-3v-3H3z" />
		<path d="M8 11h8" />
	</PortSvg>
)

/** Micro-A and micro-AB socket: slim rectangular shell, tongue offset upward. */
export const IconUsbMicroA: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<rect x="3" y="8" width="18" height="8" rx="1" />
		<path d="M7 11h10" />
	</PortSvg>
)

/** Micro-B socket: slim trapezoid with sloped lower corners. */
export const IconUsbMicroB: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M3 8h18v2.5L17 16H7l-4-5.5z" />
		<path d="M8 11h8" />
	</PortSvg>
)

/** DE-9 socket: D-shaped shell with its 5 + 4 pins. */
export const IconDe9: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M3.5 6h17a1.5 1.5 0 0 1 1.5 1.8l-1.6 9a1.5 1.5 0 0 1-1.5 1.2H5.100a1.5 1.5 0 0 1-1.5-1.200l-1.6-9A1.5 1.5 0 0 1 3.5 6z" />
		<g stroke-width="1.75">
			<path d="M6 10.500h.01M9 10.500h.01M12 10.500h.01M15 10.500h.01M18 10.500h.01" />
			<path d="M7.5 14h.01M10.5 14h.01M13.5 14h.01M16.5 14h.01" />
		</g>
	</PortSvg>
)

/** DB-25 socket: long, flat D-shell with its 13 + 12 pins. */
export const IconDb25: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M2.5 7.500h19a1.5 1.5 0 0 1 1.45 1.900l-1.5 6a1.5 1.5 0 0 1-1.45 1.100H4a1.5 1.5 0 0 1-1.45-1.100l-1.5-6A1.5 1.5 0 0 1 2.5 7.500z" />
		<g stroke-width="1" stroke-dasharray="0 1.5">
			<path d="M3.75 10.750h16.5" />
			<path d="M5 13.250h14" />
		</g>
	</PortSvg>
)

/** RJ-11 jack: six-position body, two central contacts. */
export const IconRj11: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M6 5h12v10h-3v4H9v-4H6z" />
		<path d="M10.5 5v4M13.5 5v4" />
	</PortSvg>
)

/** RJ-12 jack: six-position body, six contacts. */
export const IconRj12: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M6 5h12v10h-3v4H9v-4H6z" />
		<path stroke-width="1" d="M8 5v4M9.6 5v4M11.2 5v4M12.8 5v4M14.4 5v4M16 5v4" />
	</PortSvg>
)

/** Mini-DIN-8 socket: round shell, key notch below, 3 + 3 + 2 pins. */
export const IconMiniDin8: IconComponent = (props: { size?: number }): JSX.Element => (
	<PortSvg size={props.size}>
		<path d="M10 21.300a9.5 9.5 0 1 1 4 0V18h-4z" />
		<path
			stroke-width="1.75"
			d="M8.5 7.500h.01M12 7.500h.01M15.5 7.500h.01M7 11.500h.01M12 11.500h.01M17 11.500h.01M8.5 15h.01M15.5 15h.01"
		/>
	</PortSvg>
)
