import { createMemo, type JSX, onMount, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { t } from '../i18n'
import { Breadcrumbs } from './breadcrumbs'
import { matchRoute, type RouteMatch, routeCrumbs } from './routes'

/** Page content for the current URL; the shell remounts it on path changes. */
export function RouteContent(props: { routePath: string }): JSX.Element {
	// The path change that resolves a different page remounts this component;
	// keep the page mounted otherwise (e.g. when permissions change).
	const match = createMemo((): RouteMatch | null => matchRoute(props.routePath), undefined, {
		equals: (a: RouteMatch | null, b: RouteMatch | null): boolean => a?.page === b?.page,
	})
	onMount(() => {
		// The router may be restoring scroll, so do not move the viewport.
		document.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
	})
	return (
		<Show when={match()} keyed fallback={<p>{t('app.pageNotFound')}</p>}>
			{(m: RouteMatch) => (
				<>
					<Breadcrumbs crumbs={routeCrumbs(props.routePath, m)} />
					{m.kind === 'detail' || m.kind === 'edit' ? (
						<Dynamic component={m.page} id={m.id} />
					) : (
						<Dynamic component={m.page} />
					)}
				</>
			)}
		</Show>
	)
}
