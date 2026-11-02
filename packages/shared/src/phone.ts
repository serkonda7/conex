import type { PhoneType } from './schemas'

/**
 * Phone number in international format: `+49 (0)521 44709-0` → `+49521447090`.
 * Drops a `(0)` trunk prefix and all separators; `00` and a leading `0`
 * (taken as a German national number) become `+…`. Numbers without any
 * prefix keep their digits only.
 *
 * Shared because the contact directory publishes numbers in this format and
 * the AGFEO LDAP plugin normalizes searched numbers the same way.
 */
export function normalizePhone(raw: string): string {
	const n = raw.replaceAll('(0)', '').replace(/[^0-9+]/g, '')
	if (n.startsWith('+')) {
		return `+${n.replaceAll('+', '')}`
	}
	if (n.startsWith('00')) {
		return `+${n.slice(2)}`
	}
	if (n.startsWith('0')) {
		return `+49${n.slice(1)}`
	}
	return n.replaceAll('+', '')
}

/**
 * Phone type suggested by a number as typed: German mobile prefixes
 * (`015x`–`017x`) are `mobile`, short numbers without any prefix
 * (`123`, `-45`) are an `extension`, everything else is a `phone`.
 * `null` while the input holds no digits yet.
 */
export function inferPhoneType(raw: string): PhoneType | null {
	const n = normalizePhone(raw)
	if (!/[0-9]/.test(n)) {
		return null
	}
	if (/^\+491[5-7]/.test(n)) {
		return 'mobile'
	}
	if (!n.startsWith('+') && n.length <= 6) {
		return 'extension'
	}
	return 'phone'
}

/**
 * Full number of an extension: the tenant's main number up to its last `-`
 * (`+49 (0)521 44709-0` → `+4952144709`) followed by the extension's digits,
 * normalized. `null` if the main number has no `-` separating the extension.
 */
export function extensionNumber(extension: string, mainNumber: string | null): string | null {
	const cut = mainNumber?.lastIndexOf('-') ?? -1
	const digits = extension.replace(/[^0-9]/g, '')
	if (mainNumber == null || cut === -1 || digits === '') {
		return null
	}
	return normalizePhone(mainNumber.slice(0, cut)) + digits
}
