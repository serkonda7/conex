/**
 * Shared loading / empty / error feedback primitives. Every list, detail,
 * and form page rendered the same three classnames by hand (`skeleton`,
 * `empty`, `app-inline-error`); these keep the exact DOM so e2e selectors
 * and assistive-tech announcements keep working.
 */
import { type JSX, Show } from 'solid-js'

/** Skeleton placeholder line shown while a resource is loading. */
export function Loading(props: { message: string }): JSX.Element {
	return <p class="skeleton">{props.message}</p>
}

/** Muted placeholder line shown when a resource resolves to nothing. */
export function Empty(props: { message: string }): JSX.Element {
	return <p class="empty">{props.message}</p>
}

/**
 * Terminal form/page error line. `alert` adds `role="alert"` for form
 * contexts (matching `FormError`); detail footers render without it, as
 * they did before.
 */
export function InlineError(props: { message: string | null; alert?: boolean }): JSX.Element {
	return (
		<Show when={props.message}>
			<div class="app-inline-error" role={props.alert === true ? 'alert' : undefined}>
				{props.message}
			</div>
		</Show>
	)
}
