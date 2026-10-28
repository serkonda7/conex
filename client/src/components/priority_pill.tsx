import type { JSX } from 'solid-js'

/** Black or white, whichever reads better on the given `#rrggbb` background. */
function contrastText(hex: string): string {
	const channel = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16)
	const luminance = (0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5)) / 255
	return luminance > 0.6 ? '#000000' : '#ffffff'
}

/** Priority name on a pill filled with the priority's color. */
export function PriorityPill(props: { name: string; color: string }): JSX.Element {
	return (
		<span
			class="priority-pill"
			style={{ 'background-color': props.color, color: contrastText(props.color) }}
		>
			{props.name}
		</span>
	)
}
