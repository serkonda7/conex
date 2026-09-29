/**
 * Device matching inside one tenant ↔ external-tenant pair.
 *
 * 1. Serial number, 2. asset tag ↔ inventory number: linked automatically
 *    when the key is unique on both sides, otherwise suggested.
 * 3. Name: suggestion only, never linked automatically.
 * Callers pass only devices without a link (and external devices that are
 * neither linked nor ignored), so manual links are never overwritten.
 */
import type { ExternalDevice } from './types'

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

export type MatchKey = 'serial' | 'asset_tag' | 'name'

export interface MatchPair {
	device_id: number
	external_id: string
	via: MatchKey
}

export interface MatchResult {
	auto: MatchPair[]
	suggestions: MatchPair[]
}

function group<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
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

export function matchDevices(locals: LocalDevice[], externals: ExternalDevice[]): MatchResult {
	const auto: MatchPair[] = []
	const suggestions: MatchPair[] = []
	const usedLocal = new Set<number>()
	const usedExternal = new Set<string>()
	const suggested = new Set<string>()

	function suggest(pair: MatchPair): void {
		const id = `${pair.device_id}|${pair.external_id}`
		if (!suggested.has(id)) {
			suggested.add(id)
			suggestions.push(pair)
		}
	}

	const keys: [
		MatchKey,
		(d: LocalDevice) => string | null,
		(e: ExternalDevice) => string | null,
	][] = [
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
	]
	for (const [via, localKey, externalKey] of keys) {
		const localGroups = group(
			locals.filter((d) => !usedLocal.has(d.id)),
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
				auto.push({ device_id: local.id, external_id: external.external_id, via })
				usedLocal.add(local.id)
				usedExternal.add(external.external_id)
				continue
			}
			for (const l of localGroup) {
				for (const e of externalGroup) {
					suggest({ device_id: l.id, external_id: e.external_id, via })
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
			suggest({ device_id: local.id, external_id: e.external_id, via: 'name' })
		}
	}

	return { auto, suggestions }
}
