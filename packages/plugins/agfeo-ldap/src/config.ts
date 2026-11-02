import fs from 'node:fs'
import { Result } from 'better-result'
import { normalizeDn } from './directory'

export interface Config {
	/** conex API root, e.g. `http://localhost:3000`; binds log in there. */
	conexUrl: string
	host: string
	port: number
	/** Normalized, like every DN handled by the server. */
	baseDn: string
	/** PEM certificate and key; set both to serve LDAPS instead of plain LDAP. */
	tls: { cert: string; key: string } | null
	/** Entries per search at most; the Dashboard reads 100. */
	maxResults: number
	/** Logs every search, to see what a client asks for. */
	debug: boolean
}

function env(name: string): string | undefined {
	const value = process.env[name]?.trim()
	return value ? value : undefined
}

function intEnv(name: string, fallback: number): Result<number, Error> {
	const raw = env(name)
	if (raw === undefined) {
		return Result.ok(fallback)
	}
	const n = Number(raw)
	return Number.isInteger(n) && n > 0
		? Result.ok(n)
		: Result.err(new Error(`${name} must be a positive integer`))
}

/** Reads the `AGFEO_LDAP_*` environment variables. */
export function loadConfig(): Result<Config, Error> {
	return Result.gen(function* () {
		const conexUrl = env('AGFEO_LDAP_CONEX_URL')?.replace(/\/+$/, '')
		if (!conexUrl) {
			return Result.err(new Error('AGFEO_LDAP_CONEX_URL is not set'))
		}

		const certPath = env('AGFEO_LDAP_TLS_CERT')
		const keyPath = env('AGFEO_LDAP_TLS_KEY')
		if ((certPath === undefined) !== (keyPath === undefined)) {
			return Result.err(new Error('Set both AGFEO_LDAP_TLS_CERT and AGFEO_LDAP_TLS_KEY'))
		}
		const tls = yield* Result.try({
			try: () =>
				certPath && keyPath
					? {
							cert: fs.readFileSync(certPath, 'utf8'),
							key: fs.readFileSync(keyPath, 'utf8'),
						}
					: null,
			catch: (e: unknown) =>
				new Error(
					`Failed to read TLS files: ${e instanceof Error ? e.message : String(e)}`,
				),
		})

		return Result.ok({
			conexUrl,
			host: env('AGFEO_LDAP_HOST') ?? '0.0.0.0',
			port: yield* intEnv('AGFEO_LDAP_PORT', tls ? 636 : 389),
			baseDn: normalizeDn(env('AGFEO_LDAP_BASE_DN') ?? 'ou=contacts,dc=conex'),
			tls,
			maxResults: yield* intEnv('AGFEO_LDAP_MAX_RESULTS', 100),
			debug: env('AGFEO_LDAP_DEBUG') === '1',
		})
	})
}
