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
import { navigate } from '../router'
import { submit_edit, useEditForm } from '../util/form'

const FACE_OPTIONS = [
	{ value: 'front', label: 'front' },
	{ value: 'rear', label: 'rear' },
]

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
					return 'Position must be a positive integer.'
				}
				if (!Number.isInteger(mount) || mount < 1) {
					return 'Mount height must be an integer of at least 1 U.'
				}
				if (!Number.isInteger(reserved) || reserved < 0) {
					return 'Reserved height must be an integer of 0 or more.'
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
		if (!current || !window.confirm(`Fachboden „${current.name ?? 'shelf'}“ löschen?`)) {
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
			backLabel="Rack"
			title="Fachboden bearbeiten"
			loaded={loaded()}
			loadingText="Fachboden wird geladen…"
			onSubmit={handleSave}
		>
			<SelectField
				id="shelf-edit-rack"
				label="Rack"
				required
				value={rackId()}
				onChange={setRackId}
				options={row_options(racks() ?? [])}
				emptyLabel="Rack…"
			/>
			<TextField
				id="shelf-edit-name"
				label="Name (optional)"
				placeholder="shelf"
				value={name()}
				onInput={setName}
			/>
			<SelectField
				id="shelf-edit-face"
				label="Seite"
				value={face()}
				disabled={rackId() === ''}
				onChange={setFace}
				options={FACE_OPTIONS}
				emptyLabel="Beide Seiten"
				hint={<Hint>Which rack face the shelf is mounted on.</Hint>}
			/>
			<TextField
				id="shelf-edit-position"
				label="Position (HE)"
				inputmode="numeric"
				required
				value={positionU()}
				onInput={setPositionU}
				hint={<Hint>Unterste HE der Montage (1-basiert).</Hint>}
			/>
			<TextField
				id="shelf-edit-mount-height"
				label="Montagehöhe (HE)"
				type="number"
				min={1}
				value={mountHeight()}
				onInput={setMountHeight}
				hint={<Hint>Höhe des Montagebands selbst (mind. 1 HE).</Hint>}
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
						Montage nutzbar
					</label>
				</div>
			</div>
			<TextField
				id="shelf-edit-reserved-height"
				label="Reservierte Höhe (HE)"
				type="number"
				min={0}
				value={reservedHeight()}
				onInput={setReservedHeight}
				hint={<Hint>Zusätzliche HE über der Montage, immer blockiert (0 = keine).</Hint>}
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
						Volle Tiefe
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
