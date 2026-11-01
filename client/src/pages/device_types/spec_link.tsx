import { websiteUrl } from 'shared/src/schemas'
import type { JSX } from 'solid-js'

/** Domain of a spec link; the full URL can overflow narrow columns. */
const specHost = (url: string): string => {
	const target = websiteUrl(url)
	return URL.canParse(target) ? new URL(target).hostname.replace(/^www\./, '') : url
}

/** External spec-sheet link, labelled with its domain. */
export function SpecLink(props: { url: string }): JSX.Element {
	return (
		<a href={websiteUrl(props.url)} target="_blank" rel="noopener noreferrer" title={props.url}>
			{specHost(props.url)}
		</a>
	)
}
