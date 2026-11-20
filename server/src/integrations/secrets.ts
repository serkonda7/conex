import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { Result } from 'better-result'
import {
	INTEGRATION_SECRET_FIELDS,
	type IntegrationSecretField,
	type IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { getIntegrationKey } from '../keys'

/**
 * Secrets of one integration, keyed by the provider's secret fields; only
 * ever decrypted server-side. An empty string means "not set".
 */
export type IntegrationSecrets<P extends ProviderId = ProviderId> = Record<
	IntegrationSecretField<P>,
	string
>

/** Validates the stored secrets object of `provider` (unknown keys are dropped). */
function secretsSchema<P extends ProviderId>(
	provider: P,
): v.GenericSchema<unknown, IntegrationSecrets<P>> {
	const fields: readonly string[] = INTEGRATION_SECRET_FIELDS[provider]
	return v.object(
		Object.fromEntries(fields.map((field) => [field, v.optional(v.string(), '')])),
	) as unknown as v.GenericSchema<unknown, IntegrationSecrets<P>>
}

/** Every secret field of `provider` set to "not set". */
export function emptySecrets<P extends ProviderId>(provider: P): IntegrationSecrets<P> {
	const fields: readonly string[] = INTEGRATION_SECRET_FIELDS[provider]
	return Object.fromEntries(fields.map((field) => [field, ''])) as IntegrationSecrets<P>
}

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

/** Decrypts the secrets of a `provider` integration row. */
export function decryptSecrets<P extends ProviderId>(
	provider: P,
	stored: string,
): Result<IntegrationSecrets<P>, Error> {
	return decryptJson(stored, secretsSchema(provider))
}
