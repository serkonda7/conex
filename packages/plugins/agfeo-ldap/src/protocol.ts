import { Result } from 'better-result'
import { BerError, BerReader, constructed, decodeString, integer, octetString, TAG } from './ber'

// ---------------------------------------------------------------------------
// LDAPv3 messages (RFC 4511) for a read-only directory: bind, search, unbind
// and abandon are understood; every other request is answered with
// `unwillingToPerform`.
// ---------------------------------------------------------------------------

export const RESULT = {
	success: 0,
	operationsError: 1,
	protocolError: 2,
	sizeLimitExceeded: 4,
	authMethodNotSupported: 7,
	noSuchObject: 32,
	invalidCredentials: 49,
	insufficientAccessRights: 50,
	busy: 51,
	unavailable: 52,
	unwillingToPerform: 53,
} as const

const OP = {
	bindRequest: 0x60,
	bindResponse: 0x61,
	unbindRequest: 0x42,
	searchRequest: 0x63,
	searchResultEntry: 0x64,
	searchResultDone: 0x65,
	abandonRequest: 0x50,
} as const

/** Requests that need an answer, mapped to the tag of their response. */
const UNSUPPORTED_RESPONSE: Record<number, number> = {
	102: 0x67, // modify
	104: 0x69, // add
	74: 0x6b, // delete
	108: 0x6d, // modify DN
	110: 0x6f, // compare
	119: 0x78, // extended (e.g. StartTLS)
}

export type Scope = 'base' | 'one' | 'sub'

export type Filter =
	| { type: 'and' | 'or'; filters: Filter[] }
	| { type: 'not'; filter: Filter }
	| { type: 'equal' | 'approx' | 'gte' | 'lte'; attr: string; value: string }
	| { type: 'substrings'; attr: string; initial?: string; any: string[]; final?: string }
	| { type: 'present'; attr: string }
	| { type: 'extensible' }

export interface SearchRequest {
	type: 'search'
	base: string
	scope: Scope
	sizeLimit: number
	typesOnly: boolean
	filter: Filter
	attributes: string[]
}

export type Request =
	/** `password` is null for SASL binds. */
	| { type: 'bind'; version: number; name: string; password: string | null }
	| { type: 'unbind' }
	| { type: 'abandon' }
	| SearchRequest
	| { type: 'unsupported'; responseTag: number }
	/** Unknown request without a response type; ignored. */
	| { type: 'ignored' }

export interface Message {
	id: number
	request: Request
}

/** Decodes one complete LDAPMessage (as cut by `elementSize`). */
export function decodeMessage(bytes: Uint8Array): Result<Message, Error> {
	return Result.try({
		try: () => {
			const msg = new BerReader(new BerReader(bytes).read(TAG.sequence).value)
			const id = msg.readInteger()
			const op = msg.read()
			// Trailing controls are ignored; none is critical for a read-only directory.
			return { id, request: decodeRequest(op.tag, op.value) }
		},
		catch: (e: unknown) =>
			e instanceof BerError ? e : new Error(`Malformed LDAP message: ${String(e)}`),
	})
}

function decodeRequest(tag: number, value: Uint8Array): Request {
	switch (tag) {
		case OP.bindRequest: {
			const r = new BerReader(value)
			const version = r.readInteger()
			const name = r.readString()
			const auth = r.read()
			// simple [0] carries the password; anything else is SASL [3].
			return {
				type: 'bind',
				version,
				name,
				password: auth.tag === 0x80 ? decodeString(auth.value) : null,
			}
		}
		case OP.unbindRequest:
			return { type: 'unbind' }
		case OP.abandonRequest:
			return { type: 'abandon' }
		case OP.searchRequest:
			return decodeSearch(value)
	}
	const responseTag = UNSUPPORTED_RESPONSE[tag]
	return responseTag !== undefined ? { type: 'unsupported', responseTag } : { type: 'ignored' }
}

const SCOPES: Scope[] = ['base', 'one', 'sub']

function decodeSearch(value: Uint8Array): SearchRequest {
	const r = new BerReader(value)
	const base = r.readString()
	const scope = SCOPES[r.readInteger(TAG.enumerated)]
	if (scope === undefined) {
		throw new BerError('Invalid search scope')
	}
	r.readInteger(TAG.enumerated) // derefAliases: there are no aliases
	const sizeLimit = r.readInteger()
	r.readInteger() // timeLimit: searches are fast
	const typesOnly = r.readBoolean()
	const filter = decodeFilter(r.read())
	const attrs = new BerReader(r.read(TAG.sequence).value)
	const attributes: string[] = []
	while (!attrs.done) {
		attributes.push(attrs.readString())
	}
	return { type: 'search', base, scope, sizeLimit, typesOnly, filter, attributes }
}

function decodeFilter(el: { tag: number; value: Uint8Array }): Filter {
	switch (el.tag) {
		case 0xa0:
		case 0xa1: {
			const r = new BerReader(el.value)
			const filters: Filter[] = []
			while (!r.done) {
				filters.push(decodeFilter(r.read()))
			}
			return { type: el.tag === 0xa0 ? 'and' : 'or', filters }
		}
		case 0xa2:
			return { type: 'not', filter: decodeFilter(new BerReader(el.value).read()) }
		case 0xa3:
		case 0xa5:
		case 0xa6:
		case 0xa8: {
			const r = new BerReader(el.value)
			const type = ({ 163: 'equal', 165: 'gte', 166: 'lte', 168: 'approx' } as const)[el.tag]
			return { type, attr: r.readString(), value: r.readString() }
		}
		case 0xa4: {
			const r = new BerReader(el.value)
			const attr = r.readString()
			const parts = new BerReader(r.read(TAG.sequence).value)
			const filter: Filter = { type: 'substrings', attr, any: [] }
			while (!parts.done) {
				const part = parts.read()
				const text = decodeString(part.value)
				if (part.tag === 0x80) {
					filter.initial = text
				} else if (part.tag === 0x81) {
					filter.any.push(text)
				} else if (part.tag === 0x82) {
					filter.final = text
				}
			}
			return filter
		}
		case 0x87:
			return { type: 'present', attr: decodeString(el.value) }
		case 0xa9:
			return { type: 'extensible' }
	}
	throw new BerError(`Unknown filter tag 0x${el.tag.toString(16)}`)
}

/** LDAP string representation (RFC 4515), for debug logging. */
export function filterToString(f: Filter): string {
	switch (f.type) {
		case 'and':
			return `(&${f.filters.map(filterToString).join('')})`
		case 'or':
			return `(|${f.filters.map(filterToString).join('')})`
		case 'not':
			return `(!${filterToString(f.filter)})`
		case 'equal':
			return `(${f.attr}=${f.value})`
		case 'approx':
			return `(${f.attr}~=${f.value})`
		case 'gte':
			return `(${f.attr}>=${f.value})`
		case 'lte':
			return `(${f.attr}<=${f.value})`
		case 'present':
			return `(${f.attr}=*)`
		case 'substrings':
			return `(${f.attr}=${f.initial ?? ''}*${f.any.map((a) => `${a}*`).join('')}${f.final ?? ''})`
		case 'extensible':
			return '(<extensible>)'
	}
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function message(id: number, op: Uint8Array): Uint8Array {
	return constructed(TAG.sequence, integer(id), op)
}

function result(tag: number, code: number, diagnostic: string, matchedDn: string): Uint8Array {
	return constructed(
		tag,
		integer(code, TAG.enumerated),
		octetString(matchedDn),
		octetString(diagnostic),
	)
}

export function resultMessage(
	id: number,
	responseTag: number,
	code: number,
	diagnostic = '',
	matchedDn = '',
): Uint8Array {
	return message(id, result(responseTag, code, diagnostic, matchedDn))
}

export function bindResponse(id: number, code: number, diagnostic = ''): Uint8Array {
	return resultMessage(id, OP.bindResponse, code, diagnostic)
}

export function searchDone(id: number, code: number, diagnostic = '', matchedDn = ''): Uint8Array {
	return resultMessage(id, OP.searchResultDone, code, diagnostic, matchedDn)
}

/** `attributes`: name and values; values are left out for `typesOnly`. */
export function searchEntry(
	id: number,
	dn: string,
	attributes: [name: string, values: string[]][],
): Uint8Array {
	const attrs = attributes.map(([name, values]) =>
		constructed(
			TAG.sequence,
			octetString(name),
			constructed(TAG.set, ...values.map((v) => octetString(v))),
		),
	)
	return message(
		id,
		constructed(OP.searchResultEntry, octetString(dn), constructed(TAG.sequence, ...attrs)),
	)
}
