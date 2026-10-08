import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { createMemo, type JSX, Show } from 'solid-js'

const ALLOWED_TAGS: string[] = [
	'p',
	'br',
	'strong',
	'em',
	'del',
	'code',
	'pre',
	'blockquote',
	'ul',
	'ol',
	'li',
	'a',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
]

// Links leave the app, so open them in a new tab without exposing `window.opener`.
DOMPurify.addHook('afterSanitizeAttributes', (node: Element): void => {
	if (node.tagName === 'A') {
		node.setAttribute('target', '_blank')
		node.setAttribute('rel', 'noopener noreferrer')
	}
})

/**
 * Sanitized GitHub-flavored markdown of user-written text; `fallback` when empty.
 * `inline` renders a single-line preview (inline formatting only) for table cells.
 */
export function Markdown(props: {
	text: string | null | undefined
	fallback?: JSX.Element
	inline?: boolean
}): JSX.Element {
	const html = createMemo((): string => {
		const text = props.text?.trim()
		if (!text) {
			return ''
		}
		const raw = props.inline
			? marked.parseInline(text.replace(/\s+/g, ' '), { async: false, gfm: true })
			: marked.parse(text, { async: false, breaks: true, gfm: true })
		return DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'title'] })
	})
	return (
		<Show when={html()} fallback={props.fallback ?? '—'}>
			<Show when={props.inline} fallback={<div class="markdown" innerHTML={html()} />}>
				<span class="markdown" title={props.text ?? ''} innerHTML={html()} />
			</Show>
		</Show>
	)
}
