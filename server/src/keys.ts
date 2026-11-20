import { hkdfSync } from 'node:crypto'
import { getConfig } from './config'

function derive(info: string, bytes: number): Buffer {
	const appKey = getConfig().auth.appKey
	return Buffer.from(hkdfSync('sha256', appKey, '', info, bytes))
}

/**
 * Bumping `auth.jwtKeyVersion` rotates the signing key alone — every session is
 * invalidated, but nothing else needs re-encryption.
 */
export function getSigningKey(): string {
	const version = getConfig().auth.jwtKeyVersion
	return derive(`conex:jwt:v${version}`, 32).toString('base64')
}

/**
 * Encrypts stored integration secrets (`integrations/secrets.ts`). Changing
 * `auth.appKey` makes stored secrets unreadable; admins re-enter them.
 */
export function getIntegrationKey(): Buffer {
	return derive('conex:integrations:v1', 32)
}

/** Signs the `state` of M365 admin consent links (`integrations/m365/consent.ts`). */
export function getConsentStateKey(): Buffer {
	return derive('conex:m365-consent:v1', 32)
}
