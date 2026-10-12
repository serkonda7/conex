import { createEffect, type JSX } from 'solid-js'
import { activeTab, navigate, useTabPath } from '../../lib/router'
import { homePath } from '../../lib/tenant_context'

/**
 * /dashboard — home route kept for the default path and old links: replaces
 * itself with the home tenant page (see `homePath`) once its tab is shown.
 */
export function DashboardPage(): JSX.Element {
	const tabPath = useTabPath()
	createEffect(() => {
		if (activeTab()?.path === tabPath) {
			navigate(homePath(), { replace: true })
		}
	})
	return null
}
