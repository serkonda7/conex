import { Result } from 'better-result'
import type { DeviceFace } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal } from 'solid-js'
import { fetch_racks } from '../api_racks'
import { delete_shelf, fetch_shelf, update_shelf } from '../api_shelves'
import {
	EditActions,
	EditPageShell,
	FormError,
	Hint,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { t, tp } from '../i18n'
import { faceOptions } from '../i18n/labels'
import { navigate } from '../router'
import { submit_edit, useEditForm } from '../util/form'

/** /shelves/:id/edit — shelf edit form. Saves back to its rack. */
export function ShelfEditPage(props: { id: number }): JSX.Element {
	const [rackId, setRackId] = createSignal('')
	const [face, setFace] = createSignal('')
	const [name, setName] = createSignal('')
	const [positionU, setPositionU] = createSignal('')
	const [mountHeight, setMountHeight] = createSignal('1')
	const [mountUsable, setMountUsable] = createSignal(false)
	const [reservedHeight, setReservedHeight] = createSignal('0')
	const [fullDepth, setFullDepth] = createSignal(true)
	const { formError, setFormError, saving, setSaving, loaded, setLoaded } = useEditForm()

	const [racks] = createResource(async () => {
		const res = await fetch_racks()
		if (Result.isError(res)) {
			setFormError(res.error.message)
			return []
		}
		return res.value.items
	})

	const [shelf] = createResource(
		() => props.id,
		async (id: number) => {
			const res = await fetch_shelf(id)
			if (Result.isError(res)) {
				setFormError(res.error.message)
				return null
			}
			setRackId(String(res.value.rack_id))
			setName(res.value.name ?? '')
			setFace(res.value.face ?? '')
			setPositionU(String(res.value.position_u))
			setMountHeight(String(res.value.mount_height))
			setMountUsable(res.value.mount_usable)
			setReservedHeight(String(res.value.reserved_height))
			setFullDepth(res.value.is_full_depth)
			setLoaded(true)
			return res.value
		},
	)

	async function handleSave(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		await submit_edit({
			name: name(),
			optionalName: true,
			validate: (): string | null => {
				const position = Number(positionU())
				const mount = mountHeight().trim() === '' ? 1 : Number(mountHeight())
				const reserved = reservedHeight().trim() === '' ? 0 : Number(reservedHeight())
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
			save: () =>
				update_shelf(props.id, {
					name: name().trim() || null,
					rack_id: Number(rackId()),
					face: (face() || null) as DeviceFace | null,
					position_u: Number(positionU()),
					mount_height: mountHeight().trim() === '' ? 1 : Number(mountHeight()),
					mount_usable: mountUsable(),
					reserved_height: reservedHeight().trim() === '' ? 0 : Number(reservedHeight()),
					is_full_depth: fullDepth(),
				}),
			setError: setFormError,
			setSaving,
			navigateTo: `/racks/${rackId()}`,
		})
	}

	async function handleDelete(): Promise<void> {
		const current = shelf()
		const confirmText = t('list.confirmDelete', {
			noun: tp('noun.shelf', 1),
			name: current?.name ?? t('shelf.namePlaceholder'),
		})
		if (!current || !window.confirm(confirmText)) {
			return
		}
		setFormError(null)
		setSaving(true)
		const result = await delete_shelf(props.id)
		setSaving(false)
		if (Result.isError(result)) {
			setFormError(result.error.message)
			return
		}
		navigate(`/racks/${current.rack_id}`, { refresh: true })
	}

	return (
		<EditPageShell
			backTo={`/racks/${shelf()?.rack_id ?? rackId()}`}
			backLabel={tp('entity.rack', 1)}
			title={t('shelf.editTitle')}
			loaded={loaded()}
			loadingText={t('shelf.loadingOne')}
			onSubmit={handleSave}
		>
			<SelectField
				id="shelf-edit-rack"
				label={tp('entity.rack', 1)}
				required
				value={rackId()}
				onChange={setRackId}
				options={row_options(racks() ?? [])}
				emptyLabel={t('shelf.rackPlaceholder')}
			/>
			<TextField
				id="shelf-edit-name"
				label={t('shelf.nameOptional')}
				placeholder={t('shelf.namePlaceholder')}
				value={name()}
				onInput={setName}
			/>
			<SelectField
				id="shelf-edit-face"
				label={t('shelf.face')}
				value={face()}
				disabled={rackId() === ''}
				onChange={setFace}
				options={faceOptions()}
				emptyLabel={t('shelf.bothFaces')}
				hint={<Hint>{t('shelf.faceHint')}</Hint>}
			/>
			<TextField
				id="shelf-edit-position"
				label={t('shelf.position')}
				inputmode="numeric"
				required
				value={positionU()}
				onInput={setPositionU}
				hint={<Hint>{t('shelf.positionHint')}</Hint>}
			/>
			<TextField
				id="shelf-edit-mount-height"
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
							id="shelf-edit-mount-usable"
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
				id="shelf-edit-reserved-height"
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
							id="shelf-edit-full-depth"
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
			<EditActions
				saving={saving()}
				cancelTo={`/racks/${shelf()?.rack_id ?? rackId()}`}
				onDelete={() => void handleDelete()}
			/>
		</EditPageShell>
	)
}
