import type { DeviceFace } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import { fetch_racks } from '../api_racks'
import { create_shelf } from '../api_shelves'
import {
	FormActions,
	FormError,
	FormPage,
	Hint,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { faceOptions } from '../i18n/labels'
import { parseId, queryParam } from '../router'
import { type FormValues, is_add_another_submit, load_rows, submit_form } from '../util/form'

/** /shelves/add — shelf create form (rack fixture, separate from devices). */
export function ShelfAddPage(): JSX.Element {
	// Rack-elevation deep link
	// (`/shelves/add?rack=<id>&position_u=<u>&face=front`) pre-fills the mount.
	const [rackId, setRackId] = createSignal(queryParam('rack'))
	const [face, setFace] = createSignal(
		queryParam('face') === 'front' || queryParam('face') === 'rear' ? queryParam('face') : '',
	)
	const [positionU, setPositionU] = createSignal(queryParam('position_u'))
	const [name, setName] = createSignal('')
	const [mountHeight, setMountHeight] = createSignal('1')
	const [mountUsable, setMountUsable] = createSignal(false)
	const [reservedHeight, setReservedHeight] = createSignal('0')
	const [fullDepth, setFullDepth] = createSignal(true)
	const [formError, setFormError] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const [racks] = createResource(() => load_rows(fetch_racks, setFormError))
	const rackRoute = (): string => {
		const id = parseId(rackId())
		return id === null ? '/racks' : `/racks/${id}`
	}

	async function handleCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const position = Number(positionU())
		const mount = mountHeight().trim() === '' ? 1 : Number(mountHeight())
		const reserved = reservedHeight().trim() === '' ? 0 : Number(reservedHeight())
		await submit_form({
			name: name(),
			optionalName: true,
			validate: (): string | null => {
				if (parseId(rackId()) === null) {
					return t('shelf.selectRackFirst')
				}
				if (!Number.isInteger(position) || position < 1) {
					return t('shelf.positionInvalid')
				}
				if (!Number.isInteger(mount) || mount < 1) {
					return t('shelf.mountHeightInvalid')
				}
				if (!Number.isInteger(reserved) || reserved < 0) {
					return t('shelf.reservedHeightInvalid')
				}
				return null
			},
			save: (values: FormValues) =>
				create_shelf({
					name: values.name || null,
					rack_id: Number(rackId()),
					face: (face() || null) as DeviceFace | null,
					position_u: position,
					mount_height: mount,
					mount_usable: mountUsable(),
					reserved_height: reserved,
					is_full_depth: fullDepth(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: rackRoute(),
			onSuccess: is_add_another_submit(e) ? () => setPositionU('') : undefined,
		})
	}

	return (
		<FormPage
			backTo={rackRoute()}
			backLabel={tp('entity.rack', 2)}
			title={t('shelf.addTitle')}
			onSubmit={handleCreate}
		>
			<SelectField
				id="shelf-rack"
				label={tp('entity.rack', 1)}
				required
				value={rackId()}
				onChange={setRackId}
				options={row_options(racks() ?? [])}
				emptyLabel={t('shelf.rackPlaceholder')}
			/>
			<TextField
				id="shelf-name"
				label={t('shelf.nameOptional')}
				placeholder={t('shelf.namePlaceholder')}
				value={name()}
				onInput={setName}
			/>
			<SelectField
				id="shelf-face"
				label={t('shelf.face')}
				value={face()}
				disabled={rackId() === ''}
				onChange={setFace}
				options={faceOptions()}
				emptyLabel={t('shelf.bothFaces')}
				hint={
					<Show when={rackId() === ''} fallback={<Hint>{t('shelf.faceHint')}</Hint>}>
						<Hint>{t('shelf.pickRackForFace')}</Hint>
					</Show>
				}
			/>
			<TextField
				id="shelf-position"
				label={t('shelf.position')}
				placeholder="10"
				inputmode="numeric"
				required
				value={positionU()}
				onInput={setPositionU}
				hint={<Hint>{t('shelf.positionHint')}</Hint>}
			/>
			<TextField
				id="shelf-mount-height"
				label={t('shelf.mountHeight')}
				type="number"
				min={1}
				value={mountHeight()}
				onInput={setMountHeight}
				hint={<Hint>{t('shelf.mountHeightHint')}</Hint>}
			/>
			<div class="field">
				<div class="field-control">
					<label class="field-checkbox-label">
						<input
							id="shelf-mount-usable"
							type="checkbox"
							checked={mountUsable()}
							onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
								setMountUsable(e.currentTarget.checked)
							}
						/>
						{t('shelf.mountUsable')}
					</label>
				</div>
			</div>
			<TextField
				id="shelf-reserved-height"
				label={t('shelf.reservedHeight')}
				type="number"
				min={0}
				value={reservedHeight()}
				onInput={setReservedHeight}
				hint={<Hint>{t('shelf.reservedHeightHint')}</Hint>}
			/>
			<div class="field">
				<div class="field-control">
					<label class="field-checkbox-label">
						<input
							id="shelf-full-depth"
							type="checkbox"
							checked={fullDepth()}
							onChange={(e: Event & { currentTarget: HTMLInputElement }) =>
								setFullDepth(e.currentTarget.checked)
							}
						/>
						{t('common.fullDepth')}
					</label>
				</div>
			</div>
			<FormError message={formError} />
			<FormActions saving={saving()} cancelTo={rackRoute()} />
		</FormPage>
	)
}
