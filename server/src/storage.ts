/**
 * Attachment files on disk. Postgres holds only the metadata
 * (`attachments`); every file is `<attachmentsDir>/<storage_key>.<ext>`.
 * Writes go to `<key>.tmp` first and are renamed into place, so a crash
 * never leaves a half-written image under a real name. The directory is
 * `[storage] attachmentsDir` (relative to the data dir, or absolute).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { Result } from 'better-result'
import type { AttachmentMime } from 'shared/src/schemas'
import { getConfig } from './config'
import { errOf } from './db/list'
import { IMAGE_EXTENSIONS } from './util/image'
import { resolveInDataDir } from './util/server_root'

let attachmentsDir: string | null = null

/** Resolves and creates the attachments directory. Call once during startup. */
export async function initStorage(serverRoot: string): Promise<void> {
	const dir = resolveInDataDir(serverRoot, getConfig().storage.attachmentsDir)
	await fs.mkdir(dir, { recursive: true })
	attachmentsDir = dir
}

/** The attachments directory; throws when `initStorage` was not called. */
export function getAttachmentsDir(): string {
	if (!attachmentsDir) {
		throw new Error('Storage has not been initialized. Call initStorage() during startup.')
	}
	return attachmentsDir
}

/** File name of a stored attachment. */
export function attachmentFileName(storageKey: string, mime: AttachmentMime): string {
	return `${storageKey}.${IMAGE_EXTENSIONS[mime]}`
}

/** Absolute path of a stored attachment. */
export function attachmentPath(storageKey: string, mime: AttachmentMime): string {
	return path.join(getAttachmentsDir(), attachmentFileName(storageKey, mime))
}

/** Writes `bytes` to `<key>.tmp`, then renames it into place. */
export async function writeAttachmentFile(
	storageKey: string,
	mime: AttachmentMime,
	bytes: Uint8Array,
): Promise<Result<undefined, Error>> {
	const tmp = path.join(getAttachmentsDir(), `${storageKey}.tmp`)
	try {
		await Bun.write(tmp, bytes)
		await fs.rename(tmp, attachmentPath(storageKey, mime))
		return Result.ok(undefined)
	} catch (e) {
		await fs.rm(tmp, { force: true }).catch(() => undefined)
		return Result.err(errOf(e))
	}
}

/**
 * Removes stored files. Missing files are fine; other failures are logged
 * and leave an orphan for the next startup sweep, never failing the
 * request that already committed.
 */
export async function removeAttachmentFiles(
	files: readonly { storage_key: string; mime: AttachmentMime }[],
): Promise<void> {
	for (const file of files) {
		try {
			await fs.rm(attachmentPath(file.storage_key, file.mime), { force: true })
		} catch (e) {
			console.error(`Failed to remove attachment file ${file.storage_key}:`, e)
		}
	}
}

/** File names in the attachments directory. */
export async function listAttachmentFiles(): Promise<Result<string[], Error>> {
	try {
		return Result.ok(await fs.readdir(getAttachmentsDir()))
	} catch (e) {
		return Result.err(errOf(e))
	}
}

/** Removes one entry of the attachments directory by file name. */
export async function removeStoredFile(name: string): Promise<Result<undefined, Error>> {
	try {
		await fs.rm(path.join(getAttachmentsDir(), name), { force: true })
		return Result.ok(undefined)
	} catch (e) {
		return Result.err(errOf(e))
	}
}
