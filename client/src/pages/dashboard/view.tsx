import type { JSX } from 'solid-js'
import { t } from '../../i18n'
import { ChangelogWidget } from './changelog_widget'
import { ConsistencyWidget } from './consistency_widget'
import { TicketWidget } from './ticket_widget'

/**
 * /dashboard — home page and target of the top bar title: a grid of
 * overview widgets.
 */
export function DashboardPage(): JSX.Element {
	return (
		<div>
			<div class="page-header">
				<h2>{t('entity.dashboard')}</h2>
			</div>
			<div class="dashboard-grid">
				<TicketWidget />
				<ConsistencyWidget />
				<ChangelogWidget />
			</div>
		</div>
	)
}
