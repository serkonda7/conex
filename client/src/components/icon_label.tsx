import type { Component, JSX } from 'solid-js'

/** Icon-plus-label content of a toolbar button. */
export function IconLabel(props: {
	icon: Component<{ size?: number }>
	children: JSX.Element
}): JSX.Element {
	return (
		<>
			<span aria-hidden="true" class="app-nav-icon">
				<props.icon size={14} />
			</span>{' '}
			{props.children}
		</>
	)
}
