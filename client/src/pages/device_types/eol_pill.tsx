import { type JSX, Show } from 'solid-js'
import { t } from '../../i18n'
import { formatDate, isPastEol } from '../../lib/time'

/** Warning pill with the EOL date of a device's type; nothing before that date. */
export function EolPill(props: { date: string | null | undefined }): JSX.Element {
	return (
		<Show when={isPastEol(props.date) && props.date}>
			{(date: () => string): JSX.Element => (
				<span class="badge badge-warning">
					{t('deviceType.eolDate')} {formatDate(date())}
				</span>
			)}
		</Show>
	)
}
