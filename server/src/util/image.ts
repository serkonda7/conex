/**
 * Image sniffing for attachment uploads: the type comes from the magic
 * bytes (never the client's Content-Type) and the pixel size from the PNG
 * `IHDR` chunk or the JPEG start-of-frame segment. Pure byte parsing, no
 * dependency and no I/O.
 */
import { Result } from 'better-result'
import type { AttachmentMime } from 'shared/src/schemas'
import { ValidationError } from '../db/errors'

export interface ImageInfo {
	mime: AttachmentMime
	width: number
	height: number
}

const UNSUPPORTED = 'Unsupported image: only PNG and JPEG files are accepted'
const CORRUPT = 'Image is damaged: its dimensions cannot be read'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** File extension on disk per type. */
export const IMAGE_EXTENSIONS: Record<AttachmentMime, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	return prefix.every((byte, i) => bytes[i] === byte)
}

function u16(bytes: Uint8Array, at: number): number {
	return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
}

function u32(bytes: Uint8Array, at: number): number {
	return u16(bytes, at) * 0x10000 + u16(bytes, at + 2)
}

/** Signature, then the `IHDR` chunk (always first): width and height big-endian. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
		return null
	}
	return { width: u32(bytes, 16), height: u32(bytes, 20) }
}

/** Start-of-frame markers carrying the dimensions (`C4`, `C8` and `CC` are not frames). */
function isStartOfFrame(marker: number): boolean {
	return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * Walks the JPEG segments up to the first start-of-frame. Its payload is
 * precision (1 byte), height (2), width (2). The size is the stored one;
 * an EXIF orientation is not applied.
 */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
	let at = 2
	while (at + 3 < bytes.length) {
		if (bytes[at] !== 0xff) {
			return null
		}
		const marker = bytes[at + 1] ?? 0
		// Fill bytes before a marker.
		if (marker === 0xff) {
			at += 1
			continue
		}
		// Standalone markers carry no length.
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			at += 2
			continue
		}
		// End of image or start of scan before any frame header.
		if (marker === 0xd9 || marker === 0xda) {
			return null
		}
		const length = u16(bytes, at + 2)
		if (length < 2) {
			return null
		}
		if (isStartOfFrame(marker)) {
			if (at + 9 > bytes.length) {
				return null
			}
			return { width: u16(bytes, at + 7), height: u16(bytes, at + 5) }
		}
		at += 2 + length
	}
	return null
}

/**
 * Detects a PNG or JPEG from its leading bytes and reads its pixel size.
 * Anything else, or a header without a usable size, is a `ValidationError`.
 */
export function readImageInfo(bytes: Uint8Array): Result<ImageInfo, Error> {
	let mime: AttachmentMime
	let size: { width: number; height: number } | null
	if (startsWith(bytes, PNG_SIGNATURE)) {
		mime = 'image/png'
		size = pngSize(bytes)
	} else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
		mime = 'image/jpeg'
		size = jpegSize(bytes)
	} else {
		return Result.err(new ValidationError(UNSUPPORTED))
	}
	if (!size || size.width === 0 || size.height === 0) {
		return Result.err(new ValidationError(CORRUPT))
	}
	return Result.ok({ mime, ...size })
}
