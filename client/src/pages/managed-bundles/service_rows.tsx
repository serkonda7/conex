import type { DeviceServiceJson } from 'shared/src/types'
import { type JSX, type Resource, Show } from 'solid-js'
import { ForeignKeyLink } from '../../components/detail_page'
import { t, tp } from '../../i18n'

/**
 * Detail-card rows of a device or VM: the managed bundle its role falls
 * under and the SLA its tenant contracted for that bundle.
 */
export function ManagedServiceRows(props: {
	service: Resource<DeviceServiceJson | null>
}): JSX.Element {
	const bundle = (): DeviceServiceJson['managed_bundle'] | undefined =>
		props.service()?.managed_bundle
	const level = (): DeviceServiceJson['service_level'] | undefined =>
		props.service()?.service_level
	return (
		<>
			<dt>{tp('entity.managedBundle', 1)}</dt>
			<dd>
				<ForeignKeyLink
					id={bundle()?.id}
					loading={props.service.loading}
					name={bundle()?.name}
					href={`/managed-bundles/${bundle()?.id ?? ''}`}
				/>
			</dd>
			<dt>{tp('entity.serviceLevel', 1)}</dt>
			<dd>
				<Show
					when={bundle() && !level()}
					fallback={
						<ForeignKeyLink
							id={level()?.id}
							loading={props.service.loading}
							name={level()?.name}
							href={`/service-levels/${level()?.id ?? ''}`}
						/>
					}
				>
					<span class="text-muted">{t('device.bundleNotContracted')}</span>
				</Show>
			</dd>
		</>
	)
}
