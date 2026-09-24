import type { DeviceFace } from 'shared/src/types'
import type { JSX } from 'solid-js'
import { createResource, createSignal, Show } from 'solid-js'
import { fetch_racks } from '../api_racks'
import { create_shelf } from '../api_shelves'
import {
	FormActions,
	FormError,
	type FormOption,
	FormPage,
	Hint,
	row_options,
	SelectField,
	TextField,
} from '../components/form'
import { parseId, queryParam } from '../router'
import { type FormValues, is_add_another_submit, load_rows, submit_form } from '../util/form'

/** Rack faces a shelf can be mounted on. */
const FACE_OPTIONS: FormOption[] = [
	{ value: 'front', label: 'front' },
	{ value: 'rear', label: 'rear' },
]

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
					return 'Select a rack first.'
				}
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
			backLabel="Racks"
			title="Neuen Fachboden hinzufügen"
			onSubmit={handleCreate}
		>
			<SelectField
				id="shelf-rack"
				label="Rack"
				required
				value={rackId()}
				onChange={setRackId}
				options={row_options(racks() ?? [])}
				emptyLabel="Rack…"
			/>
			<TextField
				id="shelf-name"
				label="Name (optional)"
				placeholder="shelf"
				value={name()}
				onInput={setName}
			/>
			<SelectField
				id="shelf-face"
				label="Seite"
				value={face()}
				disabled={rackId() === ''}
				onChange={setFace}
				options={FACE_OPTIONS}
				emptyLabel="Beide Seiten"
				hint={
					<Show
						when={rackId() === ''}
						fallback={<Hint>Which rack face the shelf is mounted on.</Hint>}
					>
						<Hint>Pick a rack first to choose a face.</Hint>
					</Show>
				}
			/>
			<TextField
				id="shelf-position"
				label="Position (HE)"
				placeholder="10"
				inputmode="numeric"
				required
				value={positionU()}
				onInput={setPositionU}
				hint={<Hint>Unterste HE der Montage (1-basiert).</Hint>}
			/>
			<TextField
				id="shelf-mount-height"
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
							id="shelf-mount-usable"
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
				id="shelf-reserved-height"
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
							id="shelf-full-depth"
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
			<FormActions saving={saving()} cancelTo={rackRoute()} />
		</FormPage>
	)
}
