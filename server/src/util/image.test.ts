import { describe, expect, test } from 'bun:test'
import { Result } from 'better-result'
import { readImageInfo } from './image'

/** APP1 segment with an EXIF IFD0 holding only the orientation tag. */
function exifSegment(orientation: number, little: boolean): number[] {
	const u16 = (v: number): number[] => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff])
	const u32 = (v: number): number[] =>
		little ? [...u16(v & 0xffff), ...u16(v >>> 16)] : [...u16(v >>> 16), ...u16(v & 0xffff)]
	const tiff = [
		...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
		...u16(42),
		...u32(8), // IFD0 right after the header
		...u16(1), // one entry
		...u16(0x0112), // orientation
		...u16(3), // SHORT
		...u32(1),
		...u16(orientation),
		0,
		0,
		...u32(0), // no next IFD
	]
	const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
	const length = payload.length + 2
	return [0xff, 0xe1, length >> 8, length & 0xff, ...payload]
}

/** Minimal JPEG header: SOI, optional EXIF, SOF0 for a 4000×3000 frame. */
function jpeg(exif: number[] = []): Uint8Array {
	const sof = [0xff, 0xc0, 0x00, 0x11, 8, 3000 >> 8, 3000 & 0xff, 4000 >> 8, 4000 & 0xff, 3]
	return new Uint8Array([0xff, 0xd8, ...exif, ...sof, ...new Array(9).fill(0)])
}

function size(bytes: Uint8Array): string {
	const info = readImageInfo(bytes)
	return Result.isOk(info) ? `${info.value.width}x${info.value.height}` : info.error.message
}

describe('readImageInfo JPEG orientation', () => {
	test('uses the frame size without EXIF', () => {
		expect(size(jpeg())).toBe('4000x3000')
	})

	test('keeps the size for upright orientations', () => {
		expect(size(jpeg(exifSegment(1, false)))).toBe('4000x3000')
		expect(size(jpeg(exifSegment(3, true)))).toBe('4000x3000')
	})

	test('swaps the size when the photo is rotated by 90°', () => {
		expect(size(jpeg(exifSegment(6, true)))).toBe('3000x4000')
		expect(size(jpeg(exifSegment(8, false)))).toBe('3000x4000')
	})
})
