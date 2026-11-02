// ---------------------------------------------------------------------------
// Minimal BER (ASN.1 Basic Encoding Rules) codec: just what LDAPv3 messages
// need — definite lengths, integers, octet strings, booleans and constructed
// types. Readers throw `BerError` internally; `protocol.ts` turns that into a
// `Result` at the message boundary.
// ---------------------------------------------------------------------------

export const TAG = {
	boolean: 0x01,
	integer: 0x02,
	octetString: 0x04,
	enumerated: 0x0a,
	sequence: 0x30,
	set: 0x31,
} as const

export class BerError extends Error {}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** One decoded tag-length-value element; `value` is the raw content. */
export interface Tlv {
	tag: number
	value: Uint8Array
}

/**
 * Total size of the first element in `buf`, or `null` while it is still
 * incomplete. Used to cut LDAP messages out of a TCP stream.
 */
export function elementSize(buf: Uint8Array): number | null {
	const header = readHeader(buf, 0)
	if (header === null) {
		return null
	}
	const size = header.contentStart + header.length
	return buf.length >= size ? size : null
}

function readHeader(
	buf: Uint8Array,
	pos: number,
): { tag: number; length: number; contentStart: number } | null {
	if (buf.length < pos + 2) {
		return null
	}
	const tag = buf[pos] as number
	if ((tag & 0x1f) === 0x1f) {
		throw new BerError('Multi-byte tags are not supported')
	}
	const first = buf[pos + 1] as number
	if (first < 0x80) {
		return { tag, length: first, contentStart: pos + 2 }
	}
	const count = first & 0x7f
	if (count === 0 || count > 4) {
		throw new BerError('Unsupported length encoding')
	}
	if (buf.length < pos + 2 + count) {
		return null
	}
	let length = 0
	for (let i = 0; i < count; i++) {
		length = length * 256 + (buf[pos + 2 + i] as number)
	}
	return { tag, length, contentStart: pos + 2 + count }
}

/** Sequential reader over the elements of one constructed value. */
export class BerReader {
	private pos = 0

	constructor(private readonly buf: Uint8Array) {}

	get done(): boolean {
		return this.pos >= this.buf.length
	}

	peekTag(): number | undefined {
		return this.buf[this.pos]
	}

	read(expectedTag?: number): Tlv {
		const header = readHeader(this.buf, this.pos)
		if (header === null || header.contentStart + header.length > this.buf.length) {
			throw new BerError('Truncated element')
		}
		if (expectedTag !== undefined && header.tag !== expectedTag) {
			throw new BerError(
				`Expected tag 0x${expectedTag.toString(16)}, got 0x${header.tag.toString(16)}`,
			)
		}
		this.pos = header.contentStart + header.length
		return {
			tag: header.tag,
			value: this.buf.subarray(header.contentStart, this.pos),
		}
	}

	readInteger(tag: number = TAG.integer): number {
		return decodeInteger(this.read(tag).value)
	}

	readString(tag: number = TAG.octetString): string {
		return decoder.decode(this.read(tag).value)
	}

	readBoolean(): boolean {
		return (this.read(TAG.boolean).value[0] ?? 0) !== 0
	}
}

export function decodeInteger(bytes: Uint8Array): number {
	if (bytes.length === 0 || bytes.length > 4) {
		throw new BerError('Unsupported integer size')
	}
	let n = (bytes[0] as number) & 0x80 ? -1 : 0
	for (const b of bytes) {
		n = n * 256 + b
	}
	return n
}

export function decodeString(bytes: Uint8Array): string {
	return decoder.decode(bytes)
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export function tlv(tag: number, content: Uint8Array): Uint8Array {
	const len = content.length
	let header: number[]
	if (len < 0x80) {
		header = [tag, len]
	} else {
		const bytes: number[] = []
		for (let n = len; n > 0; n = Math.floor(n / 256)) {
			bytes.unshift(n % 256)
		}
		header = [tag, 0x80 | bytes.length, ...bytes]
	}
	const out = new Uint8Array(header.length + len)
	out.set(header)
	out.set(content, header.length)
	return out
}

export function constructed(tag: number, ...parts: Uint8Array[]): Uint8Array {
	const size = parts.reduce((sum, p) => sum + p.length, 0)
	const content = new Uint8Array(size)
	let pos = 0
	for (const p of parts) {
		content.set(p, pos)
		pos += p.length
	}
	return tlv(tag, content)
}

/** Non-negative integers only (message ids, result codes). */
export function integer(n: number, tag: number = TAG.integer): Uint8Array {
	const bytes: number[] = []
	for (let v = n; v > 0; v = Math.floor(v / 256)) {
		bytes.unshift(v % 256)
	}
	if (bytes.length === 0 || (bytes[0] as number) & 0x80) {
		bytes.unshift(0)
	}
	return tlv(tag, Uint8Array.from(bytes))
}

export function octetString(s: string, tag: number = TAG.octetString): Uint8Array {
	return tlv(tag, encoder.encode(s))
}
