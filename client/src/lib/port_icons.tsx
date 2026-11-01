/** Connector drawings shared with the port-types documentation. */
import type { JSX } from 'solid-js'
import portIcons from '../../../docs/src/img/port-icons.svg?url&no-inline'
import type { IconComponent } from './icons'

/** Use the same SVG symbol in the app and in the documentation. */
function portIcon(name: string): IconComponent {
	return (props: { size?: number }): JSX.Element => (
		<svg
			width={props.size ?? 24}
			height={props.size ?? 24}
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<use href={`${portIcons}#${name}`} />
		</svg>
	)
}

export const IconRj45: IconComponent = portIcon('rj45')
export const IconFiber: IconComponent = portIcon('fiber')
export const IconUsbA: IconComponent = portIcon('usb-a')
export const IconUsbB: IconComponent = portIcon('usb-b')
export const IconUsbC: IconComponent = portIcon('usb-c')
export const IconUsbMiniA: IconComponent = portIcon('usb-mini-a')
export const IconUsbMiniB: IconComponent = portIcon('usb-mini-b')
export const IconUsbMicroA: IconComponent = portIcon('usb-micro-a')
export const IconUsbMicroB: IconComponent = portIcon('usb-micro-b')
export const IconDe9: IconComponent = portIcon('de9')
export const IconDb25: IconComponent = portIcon('db25')
export const IconRj11: IconComponent = portIcon('rj11')
export const IconRj12: IconComponent = portIcon('rj12')
export const IconMiniDin8: IconComponent = portIcon('mini-din8')
export const IconPowerInlet: IconComponent = portIcon('power-inlet')
export const IconSchuko: IconComponent = portIcon('schuko')
export const IconHdmi: IconComponent = portIcon('hdmi')
export const IconDisplayPort: IconComponent = portIcon('displayport')
export const IconVga: IconComponent = portIcon('vga')
export const IconDvi: IconComponent = portIcon('dvi')
export const IconC13: IconComponent = portIcon('c13')
export const IconC20: IconComponent = portIcon('c20')
export const IconC19: IconComponent = portIcon('c19')
export const IconC8: IconComponent = portIcon('c8')
export const IconC7: IconComponent = portIcon('c7')
export const IconC6: IconComponent = portIcon('c6')
export const IconC5: IconComponent = portIcon('c5')
export const IconDcTerminal: IconComponent = portIcon('dc-terminal')
export const IconDcBarrel: IconComponent = portIcon('dc-barrel')
