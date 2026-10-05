import { createEffect, createMemo, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { t } from '../i18n'
import { activeTabId, tabPathContext } from '../lib/router'
import { Breadcrumbs } from './breadcrumbs'
import { matchRoute, type RouteMatch, routeCrumbs } from './routes'

/** Page content for one tab; `routePath` is that tab's own path. */
export function RouteContent(props: { routePath: string; tabId: number }): JSX.Element {
	const TabContext = tabPathContext()
	// A pane remounts whenever its tab's path changes, so only a permission
	// change can re-resolve the route: keep the page mounted unless the
	// resolved page itself differs.
	const match = createMemo((): RouteMatch | null => matchRoute(props.routePath), undefined, {
		equals: (a: RouteMatch | null, b: RouteMatch | null): boolean => a?.page === b?.page,
	})
	// Tabs stay mounted in the background, so autofocus-on-mount only fires
	// on first visit. Refocus the page's autofocus target on activation, but
	// leave focus alone when it is already inside this tab (e.g. switching
	// back mid-edit).
	createEffect(() => {
		if (activeTabId() !== props.tabId) {
			return
		}
		const pane = document.querySelector<HTMLElement>(`[data-tab-id="${props.tabId}"]`)
		const focused = document.activeElement
		if (!pane || (focused instanceof HTMLElement && pane.contains(focused))) {
			return
		}
		pane.querySelector<HTMLElement>('[data-autofocus]')?.focus()
	})
	return (
		<TabContext.Provider value={props.routePath}>
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
		</TabContext.Provider>
	)
}
