import { normalizePhone } from 'shared/src/phone'
import type { DirectoryContact } from 'shared/src/schemas'
import type { Filter } from './protocol'

// ---------------------------------------------------------------------------
// Directory tree: `<baseDn>` (organizationalUnit) with one inetOrgPerson
// entry `uid=<employee id>,<baseDn>` per conex directory contact.
// Attribute names follow MS Active Directory, the Dashboard's usual LDAP peer.
// ---------------------------------------------------------------------------

export interface Entry {
	/** Normalized (see `normalizeDn`). */
	dn: string
	/** Attribute name as published, and its values. */
	attributes: [name: string, values: string[]][]
}

/** Lower case, no spaces around `,` and `=`. conex values never contain escaped commas. */
export function normalizeDn(dn: string): string {
	return dn
		.split(',')
		.map((rdn) =>
			rdn
				.split('=')
				.map((s) => s.trim())
				.join('='),
		)
		.filter((rdn) => rdn !== '')
		.join(',')
		.toLowerCase()
}

/** `dn` equals `ancestor` or lies below it (`''` is the root of everything). */
export function isWithin(dn: string, ancestor: string): boolean {
	return ancestor === '' || dn === ancestor || dn.endsWith(`,${ancestor}`)
}

export function parentDn(dn: string): string {
	const i = dn.indexOf(',')
	return i === -1 ? '' : dn.slice(i + 1)
}

function attrs(pairs: [string, string | null | undefined][]): Entry['attributes'] {
	return pairs.flatMap(([name, value]): Entry['attributes'] => (value ? [[name, [value]]] : []))
}

export function baseEntry(baseDn: string): Entry {
	const ou = baseDn.split(',')[0]?.split('=')[1] ?? ''
	return {
		dn: baseDn,
		attributes: [
			['objectClass', ['top', 'organizationalUnit']],
			['ou', [ou]],
		],
	}
}

export function rootDse(baseDn: string): Entry {
	return {
		dn: '',
		attributes: [
			['objectClass', ['top']],
			['namingContexts', [baseDn]],
			['supportedLDAPVersion', ['3']],
			['vendorName', ['conex']],
		],
	}
}

export function contactEntry(row: DirectoryContact, baseDn: string): Entry {
	return {
		dn: `uid=${row.id},${baseDn}`,
		attributes: [
			['objectClass', ['top', 'person', 'organizationalPerson', 'inetOrgPerson']],
			...attrs([
				['uid', String(row.id)],
				['cn', row.name],
				['displayName', row.name],
				['givenName', row.first_name],
				['sn', row.last_name],
				['company', row.company],
				['customerNumber', row.customer_number],
				['department', row.title],
				['mail', row.email],
				['telephoneNumber', row.phone_business],
				['otherTelephone', row.phone_business2],
				['homePhone', row.phone_home],
				['otherHomePhone', row.phone_home2],
				['mobile', row.phone_mobile],
				['otherMobile', row.phone_mobile2],
				['homeMobile', row.phone_mobile_home],
				['otherHomeMobile', row.phone_mobile_home2],
			]),
		],
	}
}

/** Selects the requested attributes (`[]` / `*`: all, `1.1`: none). */
export function selectAttributes(
	entry: Entry,
	requested: string[],
	typesOnly: boolean,
): Entry['attributes'] {
	const wanted = new Set(requested.map((a) => a.toLowerCase()))
	const all = wanted.size === 0 || wanted.has('*')
	return entry.attributes
		.filter(([name]) => all || wanted.has(name.toLowerCase()))
		.map(([name, values]) => [name, typesOnly ? [] : values])
}

// ---------------------------------------------------------------------------
// Filter evaluation (RFC 4511 three-valued logic: `undefined` = Undefined).
// Matching ignores case; searched phone numbers are normalized like the
// published ones, so the Dashboard finds a contact with either number format.
// ---------------------------------------------------------------------------

const PHONE_ATTRIBUTES = new Set([
	'telephonenumber',
	'othertelephone',
	'homephone',
	'otherhomephone',
	'mobile',
	'othermobile',
	'homemobile',
	'otherhomemobile',
])

function valuesOf(entry: Entry, attr: string): string[] | undefined {
	const name = attr.toLowerCase()
	return entry.attributes.find(([n]) => n.toLowerCase() === name)?.[1]
}

/** Assertion value as compared against stored values of `attr`. */
function assertion(attr: string, value: string, whole: boolean): string {
	if (!PHONE_ATTRIBUTES.has(attr.toLowerCase())) {
		return value.toLowerCase()
	}
	// Substring parts are only stripped: a fragment has no country context.
	return whole ? normalizePhone(value) : value.replace(/[^0-9+]/g, '')
}

export function matches(filter: Filter, entry: Entry): boolean | undefined {
	switch (filter.type) {
		case 'and': {
			let res: boolean | undefined = true
			for (const f of filter.filters) {
				const r = matches(f, entry)
				if (r === false) {
					return false
				}
				if (r === undefined) {
					res = undefined
				}
			}
			return res
		}
		case 'or': {
			let res: boolean | undefined = false
			for (const f of filter.filters) {
				const r = matches(f, entry)
				if (r === true) {
					return true
				}
				if (r === undefined) {
					res = undefined
				}
			}
			return res
		}
		case 'not': {
			const r = matches(filter.filter, entry)
			return r === undefined ? undefined : !r
		}
		case 'present':
			return valuesOf(entry, filter.attr) !== undefined
		case 'extensible':
			return undefined
	}
	const values = valuesOf(entry, filter.attr)?.map((v) => v.toLowerCase())
	if (values === undefined) {
		return false
	}
	switch (filter.type) {
		case 'equal':
		case 'approx': {
			const a = assertion(filter.attr, filter.value, true)
			return values.includes(a)
		}
		case 'gte': {
			const a = assertion(filter.attr, filter.value, true)
			return values.some((v) => v >= a)
		}
		case 'lte': {
			const a = assertion(filter.attr, filter.value, true)
			return values.some((v) => v <= a)
		}
		case 'substrings': {
			const part = (s: string): string => assertion(filter.attr, s, false)
			return values.some((v) => matchesSubstrings(v, filter, part))
		}
	}
}

function matchesSubstrings(
	value: string,
	filter: Extract<Filter, { type: 'substrings' }>,
	part: (s: string) => string,
): boolean {
	let pos = 0
	if (filter.initial !== undefined) {
		const initial = part(filter.initial)
		if (!value.startsWith(initial)) {
			return false
		}
		pos = initial.length
	}
	for (const any of filter.any) {
		const i = value.indexOf(part(any), pos)
		if (i === -1) {
			return false
		}
		pos = i + part(any).length
	}
	if (filter.final !== undefined) {
		const final = part(filter.final)
		return value.length - final.length >= pos && value.endsWith(final)
	}
	return true
}
