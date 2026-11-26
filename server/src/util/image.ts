/**
 * Image sniffing for attachment uploads: the type comes from the magic
 * bytes (never the client's Content-Type) and the pixel size from the PNG
 * `IHDR` chunk or the JPEG start-of-frame segment, swapped when the EXIF
 * orientation rotates the image by 90° (phone photos), so the size matches
 * what browsers display. Pure byte parsing, no dependency and no I/O.
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

/**
 * EXIF orientation (tag `0x0112` in IFD0) of an `APP1` segment payload, or
 * null when it is not EXIF or carries no orientation.
 */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
	const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
	if (!header.every((byte, i) => bytes[start + i] === byte)) {
		return null
	}
	const tiff = start + 6
	const order = u16(bytes, tiff)
	if (order !== 0x4949 && order !== 0x4d4d) {
		return null
	}
	const little = order === 0x4949
	const read16 = (at: number): number => {
		const value = u16(bytes, at)
		return little ? ((value & 0xff) << 8) | (value >> 8) : value
	}
	const read32 = (at: number): number =>
		little ? read16(at) + read16(at + 2) * 0x10000 : read16(at) * 0x10000 + read16(at + 2)
	const ifd = tiff + read32(tiff + 4)
	if (ifd + 2 > end) {
		return null
	}
	const count = read16(ifd)
	for (let i = 0; i < count; i++) {
		const entry = ifd + 2 + i * 12
		if (entry + 12 > end) {
			return null
		}
		if (read16(entry) === 0x0112) {
			return read16(entry + 8)
		}
	}
	return null
}

/** Start-of-frame markers carrying the dimensions (`C4`, `C8` and `CC` are not frames). */
function isStartOfFrame(marker: number): boolean {
	return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * Walks the JPEG segments up to the first start-of-frame. Its payload is
 * precision (1 byte), height (2), width (2). An EXIF orientation of 5–8
 * (transposed or rotated by 90°) found on the way swaps width and height.
 */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
	let at = 2
	let orientation: number | null = null
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
			const width = u16(bytes, at + 7)
			const height = u16(bytes, at + 5)
			return orientation !== null && orientation >= 5 && orientation <= 8
				? { width: height, height: width }
				: { width, height }
		}
		if (marker === 0xe1 && orientation === null) {
			orientation = exifOrientation(bytes, at + 4, Math.min(at + 2 + length, bytes.length))
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
