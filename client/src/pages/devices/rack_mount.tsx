import { Combobox } from '@serkonda7/solid-components'
import type { InputEventAndTarget } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { Field, type FormOption } from '../../components/form'
import { t, tp } from '../../i18n'
import { faceOptions } from '../../i18n/labels'

/**
 * Rack, face and U position on one row: face and position only mean
 * something together with the rack. Ids are `<idPrefix>-rack`, `-face` and
 * `-position`.
 */
export function RackMountField(props: {
	idPrefix: string
	rackId: string
	face: string
	positionU: string
	onRackChange: (value: string) => void
	onFaceChange: (value: string) => void
	onPositionInput: (value: string) => void
	racks: FormOption[]
	rackEmptyLabel: string
	faceEmptyLabel: string
	rackDisabled?: boolean
	/** Disables face and position. */
	mountDisabled?: boolean
	hint?: JSX.Element
}): JSX.Element {
	return (
		<Field label={tp('entity.rack', 1)} for={`${props.idPrefix}-rack`} hint={props.hint}>
			<div class="rack-mount-row">
				<Combobox
					id={`${props.idPrefix}-rack`}
					value={props.rackId}
					disabled={props.rackDisabled}
					onChange={props.onRackChange}
					options={props.racks}
					emptyLabel={props.rackEmptyLabel}
					searchLabel={t('common.search')}
					noMatchesLabel={t('common.noMatchingObjects')}
				/>
				<Combobox
					id={`${props.idPrefix}-face`}
					class="rack-mount-face"
					ariaLabel={t('shelf.face')}
					value={props.face}
					disabled={props.mountDisabled}
					onChange={props.onFaceChange}
					options={faceOptions()}
					emptyLabel={props.faceEmptyLabel}
					searchLabel={t('common.search')}
					noMatchesLabel={t('common.noMatchingObjects')}
				/>
				<input
					id={`${props.idPrefix}-position`}
					class="rack-mount-position"
					aria-label={t('common.position')}
					placeholder={t('common.position')}
					inputmode="numeric"
					value={props.positionU}
					disabled={props.mountDisabled}
					onInput={(e: InputEventAndTarget) =>
						props.onPositionInput(e.currentTarget.value)
					}
				/>
			</div>
		</Field>
	)
}
