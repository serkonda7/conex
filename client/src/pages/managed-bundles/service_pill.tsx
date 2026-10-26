import type { DeviceServiceJson } from 'shared/src/types'
import { type JSX, type Resource, Show } from 'solid-js'
import { t } from '../../i18n'

/**
 * Pill above the detail card of a device or VM: the managed bundle its role
 * falls under and the SLA its tenant contracted for that bundle. Styled like
 * the bundle pills of the tenant page; hidden when no bundle applies.
 */
export function ManagedServicePill(props: {
	service: Resource<DeviceServiceJson | null>
}): JSX.Element {
	const bundle = (): DeviceServiceJson['managed_bundle'] | undefined =>
		props.service()?.managed_bundle
	const level = (): DeviceServiceJson['service_level'] | undefined =>
		props.service()?.service_level
	return (
		<Show when={bundle()}>
			{(b: () => NonNullable<DeviceServiceJson['managed_bundle']>): JSX.Element => (
				<div class="tenant-subheading">
					<span class="badge tenant-bundle">
						{b().name}
						{' · '}
						<Show
							when={level()}
							fallback={
								<span class="text-muted">{t('device.bundleNotContracted')}</span>
							}
						>
							{level()?.name}
						</Show>
					</span>
				</div>
			)}
		</Show>
	)
}
