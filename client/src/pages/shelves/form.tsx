import { Result } from 'better-result'
import type { DeviceFace } from 'shared/src/types'
import { createSignal, type JSX, Show } from 'solid-js'
import { fetch_racks } from '../../api/racks'
import {
	create_shelf,
	delete_shelf,
	fetch_shelf,
	type ShelfRowJson,
	update_shelf,
} from '../../api/shelves'
import {
	CheckboxField,
	FormPage,
	Hint,
	row_options,
	SelectField,
	TextField,
} from '../../components/form'
import { t, tp } from '../../i18n'
import { faceOptions } from '../../i18n/labels'
import { is_add_another_submit, submit_form, useEntityForm } from '../../lib/form'
import { createRows } from '../../lib/resource'
import { type Crumb, navigate, parseId, queryParam } from '../../lib/router'

/** `?face=` of a rack-elevation deep link, if it names a face. */
function queryFace(): string {
	const face = queryParam('face')
	return face === 'front' || face === 'rear' ? face : ''
}

/** Whole number from a field, `fallback` when blank, NaN when malformed. */
function count(value: string, fallback: number): number {
	return value.trim() === '' ? fallback : Number(value)
}

/** Shelf create (`id` omitted) or edit form; saves back to its rack. */
function ShelfForm(props: { id?: number }): JSX.Element {
	// Rack-elevation deep link
	// (`/shelves/add?rack=<id>&position_u=<u>&face=front`) pre-fills the mount.
	const [rackId, setRackId] = createSignal(queryParam('rack'))
	const [face, setFace] = createSignal(queryFace())
	const [positionU, setPositionU] = createSignal(queryParam('position_u'))
	const [name, setName] = createSignal('')
	const [mountHeight, setMountHeight] = createSignal('1')
	const [mountUsable, setMountUsable] = createSignal(false)
	const [reservedHeight, setReservedHeight] = createSignal('0')
	const [fullDepth, setFullDepth] = createSignal(true)
	const form = useEntityForm({
		id: props.id,
		load: fetch_shelf,
		fill: (row: ShelfRowJson) => {
			setRackId(String(row.rack_id))
			setName(row.name ?? '')
			setFace(row.face ?? '')
			setPositionU(String(row.position_u))
			setMountHeight(String(row.mount_height))
			setMountUsable(row.mount_usable)
			setReservedHeight(String(row.reserved_height))
			setFullDepth(row.is_full_depth)
		},
	})
	const [racks] = createRows(fetch_racks, form.setError)
	const prefix = form.editing ? 'shelf-edit' : 'shelf'

	const rackRoute = (): string => {
		const id = parseId(String(form.record()?.rack_id ?? rackId()))
		return id === null ? '/racks' : `/racks/${id}`
	}
	const rackCrumbs = (): Crumb[] => {
		const id = parseId(String(form.record()?.rack_id ?? rackId()))
		const rack = racks()?.find((r) => r.id === id)
		return [
			{ label: tp('entity.rack', 2), href: '/racks' },
			...(rack ? [{ label: rack.name, href: `/racks/${rack.id}` }] : []),
		]
	}
	const shelfName = (): string | undefined => {
		const shelf = form.record()
		return shelf ? shelf.name || t('common.unitPosition', { u: shelf.position_u }) : undefined
	}

	function validate(): string | null {
		const position = Number(positionU())
		const mount = count(mountHeight(), 1)
		const reserved = count(reservedHeight(), 0)
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
	}

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const id = props.id
		const body = {
			name: name().trim() || null,
			rack_id: Number(rackId()),
			face: (face() || null) as DeviceFace | null,
			position_u: Number(positionU()),
			mount_height: count(mountHeight(), 1),
			mount_usable: mountUsable(),
			reserved_height: count(reservedHeight(), 0),
			is_full_depth: fullDepth(),
		}
		await submit_form({
			form,
			name: name(),
			optionalName: true,
			validate,
			save: () => (id === undefined ? create_shelf(body) : update_shelf(id, body)),
			navigateTo: rackRoute(),
			onSuccess: is_add_another_submit(e) ? () => setPositionU('') : undefined,
		})
	}

	async function handleDelete(): Promise<void> {
		const shelf = form.record()
		const confirmText = t('list.confirmDelete', {
			noun: tp('noun.shelf', 1),
			name: shelf?.name ?? t('shelf.namePlaceholder'),
		})
		if (!shelf || !window.confirm(confirmText)) {
			return
		}
		form.setError(null)
		form.setSaving(true)
		const res = await delete_shelf(shelf.id)
		form.setSaving(false)
		if (Result.isError(res)) {
			form.setError(res.error.message)
			return
		}
		navigate(`/racks/${shelf.rack_id}`, { refresh: true })
	}

	return (
		<FormPage
			form={form}
			title={form.editing ? t('shelf.editTitle') : t('shelf.addTitle')}
			name={shelfName()}
			crumbs={rackCrumbs()}
			loadingText={t('shelf.loadingOne')}
			cancelTo={rackRoute()}
			onSubmit={handleSubmit}
			onDelete={() => void handleDelete()}
		>
			<SelectField
				id={`${prefix}-rack`}
				label={tp('entity.rack', 1)}
				required
				value={rackId()}
				onChange={setRackId}
				options={row_options(racks() ?? [])}
				emptyLabel={t('shelf.rackPlaceholder')}
			/>
			<TextField
				id={`${prefix}-name`}
				label={t('shelf.nameOptional')}
				placeholder={t('shelf.namePlaceholder')}
				value={name()}
				onInput={setName}
			/>
			<SelectField
				id={`${prefix}-face`}
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
				id={`${prefix}-position`}
				label={t('shelf.position')}
				placeholder={form.editing ? undefined : '10'}
				inputmode="numeric"
				required
				value={positionU()}
				onInput={setPositionU}
				hint={<Hint>{t('shelf.positionHint')}</Hint>}
			/>
			<TextField
				id={`${prefix}-mount-height`}
				label={t('shelf.mountHeight')}
				type="number"
				min={1}
				value={mountHeight()}
				onInput={setMountHeight}
				hint={<Hint>{t('shelf.mountHeightHint')}</Hint>}
			/>
			<CheckboxField
				id={`${prefix}-mount-usable`}
				label={t('shelf.mountUsable')}
				checked={mountUsable()}
				onChange={setMountUsable}
			/>
			<TextField
				id={`${prefix}-reserved-height`}
				label={t('shelf.reservedHeight')}
				type="number"
				min={0}
				value={reservedHeight()}
				onInput={setReservedHeight}
				hint={<Hint>{t('shelf.reservedHeightHint')}</Hint>}
			/>
			<CheckboxField
				id={`${prefix}-full-depth`}
				label={t('common.fullDepth')}
				checked={fullDepth()}
				onChange={setFullDepth}
			/>
		</FormPage>
	)
}

/** /shelves/add — shelf create form (rack fixture, separate from devices). */
export function ShelfAddPage(): JSX.Element {
	return <ShelfForm />
}

/** /shelves/:id/edit — shelf edit form. Saves back to its rack. */
export function ShelfEditPage(props: { id: number }): JSX.Element {
	return <ShelfForm id={props.id} />
}
