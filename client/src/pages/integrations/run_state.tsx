import { type JSX, Show } from 'solid-js'
import { syncStateLabel } from '../../i18n/labels'
import { formatTime } from '../../lib/time'

/** `State (time) · error` line of a sync run. */
export function RunStateLine(props: {
	run: {
		state: string
		started_at: number
		finished_at: number | null
		error: string | null
	}
}): JSX.Element {
	return (
		<div>
			{syncStateLabel(props.run.state)}
			{' ('}
			{formatTime(props.run.finished_at ?? props.run.started_at)}
			{')'}
			<Show when={props.run.error}>
				{' · '}
				<span class="text-danger">{props.run.error}</span>
			</Show>
		</div>
	)
}
