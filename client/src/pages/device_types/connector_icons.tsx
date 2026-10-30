/** Front-view line drawings of the connectors in the add-component menu. They
 * draw in `currentColor` like the rack form factor schematics. */
import type { JSX } from 'solid-js'

function Connector(props: { children: JSX.Element }): JSX.Element {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 48 48"
			width="64"
			height="64"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{props.children}
		</svg>
	)
}

/** RJ-45 jack: latch notch below, eight contacts on top. */
export function Rj45Icon(): JSX.Element {
	return (
		<Connector>
			<path d="M7 9h34v23h-8v4h-4v4H19v-4h-4v-4H7z" />
			<path d="M13.5 9v8M16.5 9v8M19.5 9v8M22.5 9v8M25.5 9v8M28.5 9v8M31.5 9v8M34.5 9v8" />
		</Connector>
	)
}

/** USB-A socket: metal shell around the contact tongue. */
export function UsbAIcon(): JSX.Element {
	return (
		<Connector>
			<rect x="4" y="13" width="40" height="22" rx="1.5" />
			<rect x="9" y="18" width="30" height="7" fill="currentColor" stroke="none" />
		</Connector>
	)
}

/** IEC C14 device inlet: chamfered shell with three blades. */
export function IecInletIcon(): JSX.Element {
	return (
		<Connector>
			<path d="M15 8h18l10 10v22H5V18z" />
			<g stroke-width="3" stroke-linecap="butt">
				<path d="M24 15v8M15 26v8M33 26v8" />
			</g>
		</Connector>
	)
}

/** Schuko socket: round recess, two pin holes, earth clips top and bottom. */
export function SchukoIcon(): JSX.Element {
	return (
		<Connector>
			<circle cx="24" cy="24" r="20" />
			<circle cx="15" cy="24" r="2.5" fill="currentColor" stroke="none" />
			<circle cx="33" cy="24" r="2.5" fill="currentColor" stroke="none" />
			<g stroke-width="3" stroke-linecap="butt">
				<path d="M19 9h10M19 39h10" />
			</g>
		</Connector>
	)
}

/** HDMI socket: tapered shell around the contact strip. */
export function HdmiIcon(): JSX.Element {
	return (
		<Connector>
			<path d="M4 15h40v11l-6 7H10l-6-7z" />
			<rect x="10" y="20" width="28" height="5" fill="currentColor" stroke="none" />
		</Connector>
	)
}

/** Keystone module: mounting frame around an RJ-45 jack. */
export function KeystoneIcon(): JSX.Element {
	return (
		<Connector>
			<rect x="6" y="5" width="36" height="38" rx="1.5" />
			<path d="M13 12h22v17h-5v3h-3v3h-6v-3h-3v-3h-5z" />
			<path d="M18 12v5M21 12v5M24 12v5M27 12v5M30 12v5" />
		</Connector>
	)
}

/** Back of a keystone module: two rows of punch-down terminals. */
export function PunchDownIcon(): JSX.Element {
	return (
		<Connector>
			<rect x="6" y="5" width="36" height="38" rx="1.5" />
			<path d="M13 13v8M19.5 13v8M28.5 13v8M35 13v8M13 27v8M19.5 27v8M28.5 27v8M35 27v8" />
			<path d="M11 13h4M17.5 13h4M26.5 13h4M33 13h4M11 35h4M17.5 35h4M26.5 35h4M33 35h4" />
		</Connector>
	)
}

/** 1U patch panel: rack ears with screw holes and a row of jacks. */
export function PatchPanelIcon(): JSX.Element {
	return (
		<Connector>
			<rect x="2" y="16" width="44" height="16" rx="1" />
			<circle cx="5.5" cy="24" r="1" fill="currentColor" stroke="none" />
			<circle cx="42.5" cy="24" r="1" fill="currentColor" stroke="none" />
			<path d="M10 20h4v7h-1v1h-2v-1h-1zM16 20h4v7h-1v1h-2v-1h-1zM22 20h4v7h-1v1h-2v-1h-1zM28 20h4v7h-1v1h-2v-1h-1zM34 20h4v7h-1v1h-2v-1h-1z" />
		</Connector>
	)
}

/** Fiber cassette: slim module with a row of LC duplex pairs. */
export function CassetteIcon(): JSX.Element {
	return (
		<Connector>
			<rect x="3" y="14" width="42" height="20" rx="1.5" />
			<path d="M10 20h3v8h-3zM14 20h3v8h-3zM20.5 20h3v8h-3zM24.5 20h3v8h-3zM31 20h3v8h-3zM35 20h3v8h-3z" />
		</Connector>
	)
}
