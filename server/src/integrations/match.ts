/**
 * Device and employee matching inside one tenant ↔ external-tenant pair.
 *
 * Devices: 1. serial number, 2. asset tag ↔ inventory number; employees:
 * email. Linked automatically when the key is unique on both sides,
 * otherwise suggested. Name: suggestion only, never linked automatically.
 * Callers pass only devices without a link (and external devices that are
 * neither linked nor ignored), so manual links are never overwritten.
 */
import type { ExternalDevice, ExternalEmployee } from './types'

/** Vendor placeholders that must never count as a serial match. */
const SERIAL_PLACEHOLDERS = new Set([
	'',
	'NA',
	'NONE',
	'NULL',
	'UNKNOWN',
	'DEFAULTSTRING',
	'TOBEFILLEDBYOEM',
	'SYSTEMSERIALNUMBER',
	'CHASSISSERIALNUMBER',
	'123456789',
	'0123456789',
])

/** Upper case without separators; null for empty values and placeholders. */
export function normalizeSerial(raw: string | null | undefined): string | null {
	const key = (raw ?? '').toUpperCase().replace(/[\s\-_.:/]/g, '')
	if (SERIAL_PLACEHOLDERS.has(key) || /^0+$/.test(key)) {
		return null
	}
	return key
}

/** Asset tags: trimmed, upper case; null when empty. */
export function normalizeTag(raw: string | null | undefined): string | null {
	const key = (raw ?? '').trim().toUpperCase()
	return key === '' ? null : key
}

/** Names: lower case, single spaces; null when empty. */
export function normalizeName(raw: string | null | undefined): string | null {
	const key = (raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
	return key === '' ? null : key
}

export interface LocalDevice {
	id: number
	name: string
	serial: string | null
	asset_tag: string | null
}

export interface LocalEmployee {
	id: number
	name: string
	email: string | null
}

export type MatchKey = 'serial' | 'asset_tag' | 'name'
export type EmployeeMatchKey = 'email' | 'name'

export interface MatchPair {
	device_id: number
	external_id: string
	via: MatchKey
}

export interface EmployeeMatchPair {
	employee_id: number
	external_id: string
	via: EmployeeMatchKey
}

export interface MatchResult {
	auto: MatchPair[]
	suggestions: MatchPair[]
}

export interface EmployeeMatchResult {
	auto: EmployeeMatchPair[]
	suggestions: EmployeeMatchPair[]
}

/** Groups items by a normalized key; items without a key are left out. */
export function group<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
	const out = new Map<string, T[]>()
	for (const item of items) {
		const k = key(item)
		if (k === null) {
			continue
		}
		const list = out.get(k)
		if (list) {
			list.push(item)
		} else {
			out.set(k, [item])
		}
	}
	return out
}

/** Emails: trimmed, lower case; null when empty. */
export function normalizeEmail(raw: string | null | undefined): string | null {
	const key = (raw ?? '').trim().toLowerCase()
	return key === '' ? null : key
}

interface Pair<K> {
	local_id: number
	external_id: string
	via: K
}

/**
 * Shared matcher: each strong key links a pair automatically when it is
 * unique on both sides, otherwise suggests every combination; names only
 * ever suggest.
 */
function matchRecords<
	L extends { id: number; name: string },
	E extends { external_id: string; name: string },
	K extends string,
>(
	locals: L[],
	externals: E[],
	keys: [K, (l: L) => string | null, (e: E) => string | null][],
	nameKey: K,
): { auto: Pair<K>[]; suggestions: Pair<K>[] } {
	const auto: Pair<K>[] = []
	const suggestions: Pair<K>[] = []
	const usedLocal = new Set<number>()
	const usedExternal = new Set<string>()
	const suggested = new Set<string>()

	function suggest(pair: Pair<K>): void {
		const id = `${pair.local_id}|${pair.external_id}`
		if (!suggested.has(id)) {
			suggested.add(id)
			suggestions.push(pair)
		}
	}

	for (const [via, localKey, externalKey] of keys) {
		const localGroups = group(
			locals.filter((l) => !usedLocal.has(l.id)),
			localKey,
		)
		const externalGroups = group(
			externals.filter((e) => !usedExternal.has(e.external_id)),
			externalKey,
		)
		for (const [key, localGroup] of localGroups) {
			const externalGroup = externalGroups.get(key)
			if (!externalGroup) {
				continue
			}
			const [local] = localGroup
			const [external] = externalGroup
			if (localGroup.length === 1 && externalGroup.length === 1 && local && external) {
				auto.push({ local_id: local.id, external_id: external.external_id, via })
				usedLocal.add(local.id)
				usedExternal.add(external.external_id)
				continue
			}
			for (const l of localGroup) {
				for (const e of externalGroup) {
					suggest({ local_id: l.id, external_id: e.external_id, via })
				}
			}
		}
	}

	const externalNames = group(
		externals.filter((e) => !usedExternal.has(e.external_id)),
		(e) => normalizeName(e.name),
	)
	for (const local of locals) {
		if (usedLocal.has(local.id)) {
			continue
		}
		const key = normalizeName(local.name)
		for (const e of key === null ? [] : (externalNames.get(key) ?? [])) {
			suggest({ local_id: local.id, external_id: e.external_id, via: nameKey })
		}
	}

	return { auto, suggestions }
}

export function matchDevices(locals: LocalDevice[], externals: ExternalDevice[]): MatchResult {
	const { auto, suggestions } = matchRecords<LocalDevice, ExternalDevice, MatchKey>(
		locals,
		externals,
		[
			[
				'serial',
				(d: LocalDevice): string | null => normalizeSerial(d.serial),
				(e: ExternalDevice): string | null => normalizeSerial(e.serial),
			],
			[
				'asset_tag',
				(d: LocalDevice): string | null => normalizeTag(d.asset_tag),
				(e: ExternalDevice): string | null => normalizeTag(e.asset_tag),
			],
		],
		'name',
	)
	const toPair = (p: Pair<MatchKey>): MatchPair => ({
		device_id: p.local_id,
		external_id: p.external_id,
		via: p.via,
	})
	return { auto: auto.map(toPair), suggestions: suggestions.map(toPair) }
}

export function matchEmployees(
	locals: LocalEmployee[],
	externals: ExternalEmployee[],
): EmployeeMatchResult {
	const { auto, suggestions } = matchRecords<LocalEmployee, ExternalEmployee, EmployeeMatchKey>(
		locals,
		externals,
		[
			[
				'email',
				(l: LocalEmployee): string | null => normalizeEmail(l.email),
				(e: ExternalEmployee): string | null => normalizeEmail(e.email),
			],
		],
		'name',
	)
	const toPair = (p: Pair<EmployeeMatchKey>): EmployeeMatchPair => ({
		employee_id: p.local_id,
		external_id: p.external_id,
		via: p.via,
	})
	return { auto: auto.map(toPair), suggestions: suggestions.map(toPair) }
}
