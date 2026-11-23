import { type JSX, onMount } from 'solid-js'
import { navigate } from '../../lib/router'
import { homePath } from '../../lib/tenant_context'

/**
 * /dashboard — home route kept for the default path and old links: replaces
 * itself with the home tenant page (see `homePath`) on mount.
 */
export function DashboardPage(): JSX.Element {
	onMount(() => navigate(homePath(), { replace: true }))
	return null
}
