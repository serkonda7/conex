/**
 * Image attachments of a site, location or rack: a thumbnail grid
 * (CSS-scaled originals) with upload by button or drop, and a lightbox per
 * image to edit its description, mark it as the floor plan (not for
 * racks), replace the file or delete it. Type and size are checked here before uploading; the server
 * checks them again from the bytes. The page loads the images once
 * (`createOwnerImages`) and uses them for its link to the floor plan page.
 */
import {
	IconPencil,
	IconReplace,
	IconStar,
	IconStarFilled,
	IconTrash,
	IconUpload,
} from '@tabler/icons-solidjs'
import { Result } from 'better-result'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIMES } from 'shared/src/schemas'
import { createSignal, For, type JSX, type Resource, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import {
	type AttachmentJson,
	type AttachmentOwner,
	attachment_file_url,
	delete_attachment,
	fetch_attachments,
	fetch_floorplan,
	replace_attachment_file,
	update_attachment,
	upload_attachment,
} from '../api/attachments'
import { locale, t, tp } from '../i18n'
import { removeConfirmingFloorplan } from '../lib/floorplan_delete'
import { createRowsFor, type ErrorSink, useAction } from '../lib/resource'
import { can } from '../lib/session'
import { Empty, InlineError, Loading } from './feedback'
import { TextAreaField } from './form'
import { IconLabel } from './icon_label'
import { Modal } from './modal'

const ACCEPT = ATTACHMENT_MIMES.join(',')

/** File size in KB below one MB, else MB with one decimal. */
function formatSize(bytes: number): string {
	const fmt = (value: number): string =>
		new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(value)
	return bytes < 1024 * 1024
		? t('attachment.kilobytes', { size: fmt(Math.max(1, Math.round(bytes / 1024))) })
		: t('attachment.megabytes', { size: fmt(bytes / (1024 * 1024)) })
}

/** Client-side pre-check; returns the message for a file the server would reject. */
function checkFile(file: File): string | null {
	if (!(ATTACHMENT_MIMES as readonly string[]).includes(file.type)) {
		return t('attachment.unsupportedType', { name: file.name })
	}
	if (file.size > ATTACHMENT_MAX_BYTES) {
		return t('attachment.tooLarge', { name: file.name, max: formatSize(ATTACHMENT_MAX_BYTES) })
	}
	return null
}

/** Opens the browser's file picker; `multiple` for uploads, single for a replace. */
function pickFiles(multiple: boolean, onPick: (files: File[]) => void): void {
	const input = document.createElement('input')
	input.type = 'file'
	input.accept = ACCEPT
	input.multiple = multiple
	input.addEventListener('change', () => onPick([...(input.files ?? [])]))
	input.click()
}

/** The images of one owner, shared by its floor-plan and images sections. */
export interface OwnerImages {
	owner: AttachmentOwner
	rows: Resource<AttachmentJson[]>
	refetch: () => void
	/** The image marked as the floor plan, if any. */
	floorplan: () => AttachmentJson | undefined
	/** Whether the owner can have a floor plan (sites and locations, not racks). */
	has_floorplan: boolean
}

/** Loads the images of `owner`; a failed fetch reports to `onError`. */
export function createOwnerImages(owner: AttachmentOwner, onError?: ErrorSink): OwnerImages {
	const [rows, { refetch }] = createRowsFor(() => owner, fetch_attachments, onError)
	return {
		owner,
		rows,
		refetch: () => void refetch(),
		floorplan: () => rows()?.find((row) => row.is_floorplan),
		has_floorplan: !('rack_id' in owner),
	}
}

/**
 * Asks before a mark change discards floor-plan content: marking `row`
 * clears the current floor plan, unmarking clears `row` itself. Only
 * plans with areas or markers ask. True to go on.
 */
async function confirmMarkChange(
	row: AttachmentJson,
	current: AttachmentJson | undefined,
): Promise<Result<boolean, Error>> {
	const cleared = row.is_floorplan ? row : current
	if (!cleared) {
		return Result.ok(true)
	}
	const plan = await fetch_floorplan(cleared.id)
	if (Result.isError(plan)) {
		return plan
	}
	const { areas, placements } = plan.value
	if (plan.value.has_hidden_content) {
		return Result.ok(
			window.confirm(
				row.is_floorplan
					? t('floorplan.confirmUnmarkHidden', { name: row.filename })
					: t('floorplan.confirmReplaceHidden', {
							name: row.filename,
							current: cleared.filename,
						}),
			),
		)
	}
	if (areas.length === 0 && placements.length === 0) {
		return Result.ok(true)
	}
	const counts = {
		name: row.filename,
		areas: tp('floorplan.areaCount', areas.length),
		markers: tp('floorplan.markerCount', placements.length),
	}
	return Result.ok(
		window.confirm(
			row.is_floorplan
				? t('floorplan.confirmUnmark', counts)
				: t('floorplan.confirmReplace', { ...counts, current: cleared.filename }),
		),
	)
}

/** Toggles the floor-plan mark of `row` after `confirmMarkChange`; true when changed. */
async function toggleFloorplan(
	row: AttachmentJson,
	current: AttachmentJson | undefined,
	action: ReturnType<typeof useAction>,
): Promise<boolean> {
	if (action.pending()) {
		return false
	}
	let changed = false
	const ok = await action.run(async () => {
		const confirmed = await confirmMarkChange(row, current)
		if (Result.isError(confirmed)) {
			return confirmed
		}
		if (!confirmed.value) {
			return Result.ok(undefined)
		}
		const updated = await update_attachment(row.id, { is_floorplan: !row.is_floorplan })
		changed = Result.isOk(updated)
		return updated
	})
	return ok && changed
}

/**
 * Lightbox: the full image, its facts, and the edit / floor-plan /
 * replace / delete actions.
 */
function AttachmentLightbox(props: {
	attachment: AttachmentJson
	/** The owner's current floor plan, for the mark confirmation. */
	floorplan: AttachmentJson | undefined
	/** Shows the floor-plan mark action. */
	has_floorplan: boolean
	on_changed: () => void
	on_deleted: () => void
	on_close: () => void
}): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [editing, setEditing] = createSignal(false)
	const [description, setDescription] = createSignal('')
	const action = useAction(setError)

	function startEdit(): void {
		setDescription(props.attachment.description ?? '')
		setEditing(true)
	}

	async function saveDescription(e: SubmitEvent): Promise<void> {
		e.preventDefault()
		const value = description().trim()
		const ok = await action.run(() =>
			update_attachment(props.attachment.id, { description: value || null }),
		)
		if (ok) {
			setEditing(false)
			props.on_changed()
		}
	}

	async function toggleMark(): Promise<void> {
		if (await toggleFloorplan(props.attachment, props.floorplan, action)) {
			props.on_changed()
		}
	}

	function replace(): void {
		pickFiles(false, async (files: File[]) => {
			const file = files[0]
			if (!file) {
				return
			}
			const invalid = checkFile(file)
			if (invalid) {
				setError(invalid)
				return
			}
			if (await action.run(() => replace_attachment_file(props.attachment.id, file))) {
				props.on_changed()
			}
		})
	}

	async function remove(): Promise<void> {
		const name = props.attachment.filename
		if (!window.confirm(t('list.confirmDelete', { noun: tp('noun.attachment', 1), name }))) {
			return
		}
		let deleted = false
		const ok = await action.run(async () => {
			const res = await removeConfirmingFloorplan(
				delete_attachment,
				props.attachment.id,
				name,
			)
			deleted = Result.isOk(res) && res.value
			return res
		})
		if (ok && deleted) {
			props.on_deleted()
		}
	}

	return (
		<Modal
			title={props.attachment.filename}
			class="attachment-lightbox"
			on_close={props.on_close}
		>
			<img
				class="attachment-full"
				src={attachment_file_url(props.attachment)}
				alt={props.attachment.description ?? props.attachment.filename}
				width={props.attachment.width_px}
				height={props.attachment.height_px}
			/>
			<p class="attachment-meta">
				{t('attachment.dimensions', {
					width: props.attachment.width_px,
					height: props.attachment.height_px,
				})}
				{' · '}
				{formatSize(props.attachment.size_bytes)}
			</p>
			<Show
				when={editing()}
				fallback={
					<p class="attachment-description">
						{props.attachment.description || t('common.noDescription')}
					</p>
				}
			>
				<form class="form-stacked" onSubmit={saveDescription}>
					<TextAreaField
						id={`attachment-${props.attachment.id}-description`}
						label={t('common.description')}
						value={description()}
						onInput={setDescription}
						rows={3}
						maxLength={500}
					/>
					<div class="modal-actions">
						<button type="submit" disabled={action.pending()}>
							{t('common.save')}
						</button>
						<button type="button" onClick={() => setEditing(false)}>
							{t('common.cancel')}
						</button>
					</div>
				</form>
			</Show>
			<Show when={!editing() && (can('edit') || can('delete'))}>
				<div class="modal-actions">
					<Show when={can('edit')}>
						<button type="button" disabled={action.pending()} onClick={startEdit}>
							<IconLabel icon={IconPencil}>
								{t('attachment.editDescription')}
							</IconLabel>
						</button>
						<Show when={props.has_floorplan}>
							<button type="button" disabled={action.pending()} onClick={toggleMark}>
								<IconLabel
									icon={props.attachment.is_floorplan ? IconStarFilled : IconStar}
								>
									{props.attachment.is_floorplan
										? t('floorplan.unmark')
										: t('floorplan.mark')}
								</IconLabel>
							</button>
						</Show>
						<button type="button" disabled={action.pending()} onClick={replace}>
							<IconLabel icon={IconReplace}>{t('attachment.replace')}</IconLabel>
						</button>
					</Show>
					<Show when={can('delete')}>
						<button
							type="button"
							class="btn-danger"
							disabled={action.pending()}
							onClick={remove}
						>
							<IconLabel icon={IconTrash}>{t('common.delete')}</IconLabel>
						</button>
					</Show>
				</div>
			</Show>
			<InlineError message={error()} alert />
		</Modal>
	)
}

/**
 * "Images" section of a site, location or rack detail page. `id` is the
 * heading anchor. Editors upload through the button or by dropping files
 * onto the grid, and mark the floor plan with the star on its thumbnail
 * (sites and locations only).
 */
export function AttachmentsSection(props: { id: string; images: OwnerImages }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const rows = props.images.rows
	const refetch = props.images.refetch
	const [openId, setOpenId] = createSignal<number | null>(null)
	const [dragging, setDragging] = createSignal(false)
	const upload = useAction(setError)
	const mark = useAction(setError)
	const open = (): AttachmentJson | undefined => rows()?.find((row) => row.id === openId())

	/** Uploads the valid files one by one; the first rejected file is reported. */
	async function uploadFiles(files: File[]): Promise<void> {
		const invalid = files.map(checkFile).find((message) => message !== null)
		const valid = files.filter((file) => checkFile(file) === null)
		for (const file of valid) {
			if (!(await upload.run(() => upload_attachment(props.images.owner, file)))) {
				break
			}
		}
		if (invalid) {
			setError(invalid)
		}
		if (valid.length > 0) {
			refetch()
		}
	}

	const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false

	function onDragOver(e: DragEvent): void {
		if (!can('edit') || !hasFiles(e)) {
			return
		}
		e.preventDefault()
		setDragging(true)
	}

	function onDragLeave(e: DragEvent & { currentTarget: HTMLElement }): void {
		// Moving between children fires leave events too.
		if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
			setDragging(false)
		}
	}

	function onDrop(e: DragEvent): void {
		setDragging(false)
		if (!can('edit') || !hasFiles(e)) {
			return
		}
		e.preventDefault()
		void uploadFiles([...(e.dataTransfer?.files ?? [])])
	}

	function afterDelete(): void {
		setOpenId(null)
		refetch()
	}

	async function toggleMark(row: AttachmentJson): Promise<void> {
		if (await toggleFloorplan(row, props.images.floorplan(), mark)) {
			refetch()
		}
	}

	return (
		<>
			<div class="section-header">
				<h3 id={props.id}>
					{t('attachment.title')} <span class="badge">{rows()?.length ?? 0}</span>
				</h3>
				<Show when={can('edit')}>
					<button
						type="button"
						disabled={upload.pending()}
						onClick={() => pickFiles(true, (files: File[]) => void uploadFiles(files))}
					>
						<IconLabel icon={IconUpload}>
							{upload.pending() ? t('attachment.uploading') : t('attachment.upload')}
						</IconLabel>
					</button>
				</Show>
			</div>
			<section
				class="attachment-drop"
				classList={{ dragging: dragging() }}
				aria-label={t('attachment.title')}
				onDragOver={onDragOver}
				onDragLeave={onDragLeave}
				onDrop={onDrop}
			>
				<Show
					when={!rows.loading}
					fallback={
						<Loading message={t('list.loading', { noun: tp('noun.attachment', 2) })} />
					}
				>
					<Show
						when={(rows()?.length ?? 0) > 0}
						fallback={
							<Empty
								message={
									can('edit') ? t('attachment.emptyDrop') : t('attachment.empty')
								}
							/>
						}
					>
						<ul class="attachment-grid">
							<For each={rows()}>
								{(row: AttachmentJson) => (
									<li class="attachment-item">
										<button
											type="button"
											class="attachment-thumb"
											aria-label={t('attachment.open', {
												name: row.filename,
											})}
											onClick={() => setOpenId(row.id)}
										>
											<img
												src={attachment_file_url(row)}
												alt={row.description ?? row.filename}
												loading="lazy"
											/>
											<span class="attachment-caption">
												{row.description || row.filename}
											</span>
										</button>
										<Show when={props.images.has_floorplan}>
											<Show
												when={can('edit')}
												fallback={
													<Show when={row.is_floorplan}>
														<span
															class="attachment-star"
															title={t('entity.floorplan.one')}
														>
															<IconStarFilled size={16} />
															<span class="visually-hidden">
																{t('entity.floorplan.one')}
															</span>
														</span>
													</Show>
												}
											>
												<button
													type="button"
													class="attachment-star"
													classList={{ marked: row.is_floorplan }}
													disabled={mark.pending()}
													aria-pressed={row.is_floorplan}
													title={
														row.is_floorplan
															? t('floorplan.unmark')
															: t('floorplan.mark')
													}
													aria-label={t(
														row.is_floorplan
															? 'floorplan.unmarkNamed'
															: 'floorplan.markNamed',
														{ name: row.filename },
													)}
													onClick={() => void toggleMark(row)}
												>
													<Dynamic
														component={
															row.is_floorplan
																? IconStarFilled
																: IconStar
														}
														size={16}
													/>
												</button>
											</Show>
										</Show>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Show>
				<Show when={dragging()}>
					<p class="attachment-drop-hint">{t('attachment.dropHere')}</p>
				</Show>
			</section>
			<InlineError message={error()} />
			<Show when={open()}>
				{(attachment: () => AttachmentJson) => (
					<AttachmentLightbox
						attachment={attachment()}
						floorplan={props.images.floorplan()}
						has_floorplan={props.images.has_floorplan}
						on_changed={refetch}
						on_deleted={afterDelete}
						on_close={() => setOpenId(null)}
					/>
				)}
			</Show>
		</>
	)
}
