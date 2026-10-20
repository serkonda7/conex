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

/** AES-256-GCM of a JSON value: `v1.<iv>.<ciphertext+tag>`, both base64. */
export function encryptJson(value: unknown): string {
	const iv = randomBytes(IV_BYTES)
	const cipher = createCipheriv('aes-256-gcm', getIntegrationKey(), iv)
	const body = Buffer.concat([
		cipher.update(JSON.stringify(value), 'utf8'),
		cipher.final(),
		cipher.getAuthTag(),
	])
	return `${VERSION}.${iv.toString('base64')}.${body.toString('base64')}`
}

/**
 * Decrypts and validates an `encryptJson` value. Fails when the app key
 * changed, the value was tampered with or it does not match `schema`.
 */
export function decryptJson<T>(
	stored: string,
	schema: v.GenericSchema<unknown, T>,
): Result<T, Error> {
	const [version, ivRaw, bodyRaw] = stored.split('.')
	if (version !== VERSION || ivRaw === undefined || bodyRaw === undefined) {
		return Result.err(new Error('Stored credentials have an unknown format'))
	}
	return Result.try({
		// Boxed: a bare generic `T` does not satisfy `Awaited<T>`.
		try: (): { value: T } => {
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
			return { value: v.parse(schema, JSON.parse(plain)) }
		},
		catch: () =>
			new Error('Stored credentials cannot be decrypted (app key changed?); re-enter them'),
	}).map((boxed) => boxed.value)
}

export function encryptSecrets(secrets: IntegrationSecrets): string {
	return encryptJson(secrets)
}

export function decryptSecrets(stored: string): Result<IntegrationSecrets, Error> {
	return decryptJson(stored, SecretsSchema)
}
