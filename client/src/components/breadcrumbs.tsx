/**
 * Breadcrumb bar above detail and form pages: the full path to the shown
 * object (`Devices › DC1 › Rack 03 › sw-core-01`). The trail comes from the
 * route table plus the ancestors the page reported (see `routeCrumbs`).
 */
import { For, type JSX, Show } from 'solid-js'
import { t } from '../i18n'
import { type Crumb, goTo } from '../router'

export function Breadcrumbs(props: { crumbs: readonly Crumb[] }): JSX.Element {
	return (
		<Show when={props.crumbs.length > 0}>
			<nav class="breadcrumbs" aria-label={t('app.breadcrumb')}>
				<ol>
					<For each={props.crumbs}>
						{(crumb: Crumb, i: () => number): JSX.Element => {
							const last = (): boolean => i() === props.crumbs.length - 1
							return (
								<li>
									<Show
										when={crumb.href !== undefined && !last()}
										fallback={
											<span aria-current={last() ? 'page' : undefined}>
												{crumb.label}
											</span>
										}
									>
										<a
											href={crumb.href}
											onClick={(e: MouseEvent): void =>
												goTo(e, crumb.href ?? '', { refresh: false })
											}
										>
											{crumb.label}
										</a>
									</Show>
								</li>
							)
						}}
					</For>
				</ol>
			</nav>
		</Show>
	)
}
