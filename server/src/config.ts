import fs from 'node:fs'
import { Result } from 'better-result'
import * as v from 'valibot'
import { getTrimmedEnv } from './util/server_root'
import { formatValibotIssues } from './util/valibot'

/**
 * Schema definition of config file structure and fields.
 */
export const configSchema = v.strictObject({
	auth: v.strictObject({
		// Backs JWT signing via HKDF-derived subkeys (see `keys.ts`).
		appKey: v.pipe(v.string(), v.minLength(32)),
		jwtKeyVersion: v.optional(v.number(), 1),
		loginRateLimit: v.optional(
			v.strictObject({
				maxAttempts: v.optional(v.number(), 10),
				windowSeconds: v.optional(v.number(), 300),
			}),
			{},
		),
		secureCookies: v.optional(v.boolean(), true), // Only disable for plain-HTTP local development
	}),
	server: v.optional(
		v.strictObject({
			host: v.optional(v.string(), '0.0.0.0'),
			port: v.optional(v.number(), 3000),
		}),
		{},
	),
	frontendUrl: v.optional(v.string()),
})

type RawConfig = v.InferOutput<typeof configSchema>

export type AppConfig = RawConfig

/** Loads and validates the configuration file from given path. */
export function load_config_file(path: string): Result<AppConfig, Error> {
	if (!fs.existsSync(path)) {
		return Result.err(new Error(`Configuration file missing at ${path}`))
	}

	// Parse TOML file content
	const content = fs.readFileSync(path, 'utf8')
	let parsed: object
	try {
		parsed = Bun.TOML.parse(content)
	} catch {
		return Result.err(new Error(`Failed to parse TOML configuration at ${path}`))
	}

	// Validate schema
	const config_res = v.safeParse(configSchema, parsed)
	if (!config_res.success) {
		return Result.err(
			new Error(
				`Invalid configuration at ${path}: ${formatValibotIssues(config_res.issues)}`,
			),
		)
	}

	return Result.ok(config_res.output as AppConfig)
}

/**
 * Resolves the listening port.
 *
 * Precedence: `CONEX_PORT` env var overrides `server.port` from the config.
 */
export function resolve_listen_port(app_config: AppConfig): number {
	const raw = getTrimmedEnv('CONEX_PORT')
	if (raw) {
		const port = Number(raw)
		if (Number.isInteger(port) && port > 0 && port < 65536) {
			return port
		}
	}
	return app_config.server.port
}

// ---------------------------------------------------------------------------
// Getters and setters for global config object.
// ---------------------------------------------------------------------------

let config: AppConfig | null = null

export function initConfig(value: AppConfig): void {
	config = value
}

export function getConfig(): AppConfig {
	if (!config) {
		throw new Error('Config has not been initialized')
	}

	return config
}
