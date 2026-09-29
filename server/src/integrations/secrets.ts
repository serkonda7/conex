import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { Result } from 'better-result'
import * as v from 'valibot'
import { getIntegrationKey } from '../keys'

/** Credentials of one integration; only ever decrypted server-side. */
export interface IntegrationSecrets {
	password: string
	erp_token: string
}

const SecretsSchema = v.object({ password: v.string(), erp_token: v.string() })

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

/** AES-256-GCM: `v1.<iv>.<ciphertext+tag>`, both base64. */
export function encryptSecrets(secrets: IntegrationSecrets): string {
	const iv = randomBytes(IV_BYTES)
	const cipher = createCipheriv('aes-256-gcm', getIntegrationKey(), iv)
	const body = Buffer.concat([
		cipher.update(JSON.stringify(secrets), 'utf8'),
		cipher.final(),
		cipher.getAuthTag(),
	])
	return `${VERSION}.${iv.toString('base64')}.${body.toString('base64')}`
}

/** Fails when the app key changed or the value was tampered with. */
export function decryptSecrets(stored: string): Result<IntegrationSecrets, Error> {
	const [version, ivRaw, bodyRaw] = stored.split('.')
	if (version !== VERSION || ivRaw === undefined || bodyRaw === undefined) {
		return Result.err(new Error('Stored credentials have an unknown format'))
	}
	return Result.try({
		try: () => {
			const body = Buffer.from(bodyRaw, 'base64')
			const decipher = createDecipheriv(
				'aes-256-gcm',
				getIntegrationKey(),
				Buffer.from(ivRaw, 'base64'),
			)
			decipher.setAuthTag(body.subarray(body.length - TAG_BYTES))
			const plain = Buffer.concat([
				decipher.update(body.subarray(0, body.length - TAG_BYTES)),
				decipher.final(),
			]).toString('utf8')
			return v.parse(SecretsSchema, JSON.parse(plain))
		},
		catch: () =>
			new Error('Stored credentials cannot be decrypted (app key changed?); re-enter them'),
	})
}
