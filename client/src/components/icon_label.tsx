import { type Component, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'

/** Icon-plus-label content of a toolbar button or table cell; just the label without `icon`. */
export function IconLabel(props: {
	icon?: Component<{ size?: number }>
	children: JSX.Element
}): JSX.Element {
	return (
		<>
			<Show when={props.icon}>
				{(icon: () => Component<{ size?: number }>): JSX.Element => (
					<>
						<span aria-hidden="true" class="app-nav-icon">
							<Dynamic component={icon()} size={14} />
						</span>{' '}
					</>
				)}
			</Show>
			{props.children}
		</>
	)
}
