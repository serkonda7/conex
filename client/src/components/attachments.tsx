/**
 * Image attachments of a site or location: a thumbnail grid (CSS-scaled
 * originals) with upload by button or drop, and a lightbox per image to
 * edit its description, replace the file or delete it. Type and size are
 * checked here before uploading; the server checks them again from the
 * bytes.
 */
import { IconPencil, IconReplace, IconTrash, IconUpload } from '@tabler/icons-solidjs'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIMES } from 'shared/src/schemas'
import { createSignal, For, type JSX, Show } from 'solid-js'
import {
	type AttachmentJson,
	type AttachmentOwner,
	attachment_file_url,
	delete_attachment,
	fetch_attachments,
	replace_attachment_file,
	update_attachment,
	upload_attachment,
} from '../api/attachments'
import { locale, t, tp } from '../i18n'
import { createRowsFor, useAction } from '../lib/resource'
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

/** Lightbox: the full image, its facts, and the edit / replace / delete actions. */
function AttachmentLightbox(props: {
	attachment: AttachmentJson
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
		if (await action.run(() => delete_attachment(props.attachment.id))) {
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
 * "Images" section of a site or location detail page. `id` is the heading
 * anchor. Editors upload through the button or by dropping files onto the
 * grid.
 */
export function AttachmentsSection(props: { id: string; owner: AttachmentOwner }): JSX.Element {
	const [error, setError] = createSignal<string | null>(null)
	const [rows, { refetch }] = createRowsFor(() => props.owner, fetch_attachments, setError)
	const [openId, setOpenId] = createSignal<number | null>(null)
	const [dragging, setDragging] = createSignal(false)
	const upload = useAction(setError)
	const open = (): AttachmentJson | undefined => rows()?.find((row) => row.id === openId())

	/** Uploads the valid files one by one; the first rejected file is reported. */
	async function uploadFiles(files: File[]): Promise<void> {
		const invalid = files.map(checkFile).find((message) => message !== null)
		const valid = files.filter((file) => checkFile(file) === null)
		for (const file of valid) {
			if (!(await upload.run(() => upload_attachment(props.owner, file)))) {
				break
			}
		}
		if (invalid) {
			setError(invalid)
		}
		if (valid.length > 0) {
			await refetch()
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

	async function afterDelete(): Promise<void> {
		setOpenId(null)
		await refetch()
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
									<li>
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
						on_changed={() => void refetch()}
						on_deleted={() => void afterDelete()}
						on_close={() => setOpenId(null)}
					/>
				)}
			</Show>
		</>
	)
}
