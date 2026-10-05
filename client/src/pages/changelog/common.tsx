import type { ChangeAction, ChangeObjectType } from 'shared/src/schemas'
import { type JSX, Show } from 'solid-js'
import type { ObjectChangeJson } from '../../api/changelog'
import { t } from '../../i18n'
import { changeActionLabel } from '../../i18n/labels'

const ACTION_BADGES: Record<ChangeAction, string> = {
	create: 'badge badge-active',
	update: 'badge badge-planned',
	delete: 'badge badge-decommissioned',
}

/** Colored action pill: created green, updated blue, deleted red. */
export function ChangeActionBadge(props: { action: ChangeAction }): JSX.Element {
	return <span class={ACTION_BADGES[props.action]}>{changeActionLabel(props.action)}</span>
}

/** Detail page sections per object type; types without one render as text. */
const OBJECT_ROUTES: Partial<Record<ChangeObjectType, string>> = {
	tenant_group: 'tenant-groups',
	tenant: 'tenants',
	site_group: 'site-groups',
	site: 'sites',
	location: 'locations',
	rack: 'racks',
	device: 'devices',
	manufacturer: 'manufacturers',
	device_type: 'device-types',
	device_role: 'device-roles',
}

/** Object name at the time of the change, linked while the object can still exist. */
export function ChangedObjectLink(props: { change: ObjectChangeJson }): JSX.Element {
	const route = (): string | undefined =>
		props.change.action === 'delete' ? undefined : OBJECT_ROUTES[props.change.object_type]
	return (
		<Show when={route()} fallback={props.change.object_repr}>
			{(r: () => string): JSX.Element => (
				<a href={`/${r()}/${props.change.object_id}`}>{props.change.object_repr}</a>
			)}
		</Show>
	)
}

/** Actor of a change; changes without a signed-in user come from the system. */
export function changeUser(change: ObjectChangeJson): string {
	return change.username || t('changelog.system')
}
