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
