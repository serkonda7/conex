import fs from 'node:fs'
import { Result } from 'better-result'
import { AI_PROVIDERS, INTEGRATION_MODES, OPENCODE_MODEL_PATTERN } from 'shared/src/schemas'
import * as v from 'valibot'
import { getTrimmedEnv } from './util/server_root'
import { formatValibotIssues } from './util/valibot'

/**
 * Schema definition of config file structure and fields.
 */
const configSchema = v.strictObject({
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
	// AI assistant; absent = disabled. Credentials prefer the environment
	// (ANTHROPIC_API_KEY, OPENCODE_SERVER_PASSWORD) over this file.
	ai: v.optional(
		v.strictObject({
			provider: v.picklist(AI_PROVIDERS),
			claude: v.optional(
				v.strictObject({
					model: v.optional(v.pipe(v.string(), v.minLength(1)), 'claude-opus-5-5'),
					// Unset = the model's default effort.
					effort: v.optional(v.picklist(['low', 'medium', 'high', 'xhigh', 'max'])),
					maxTokens: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 64_000),
					apiKey: v.optional(v.pipe(v.string(), v.minLength(1))),
				}),
				{},
			),
			opencode: v.optional(
				v.strictObject({
					// Base URL of `opencode serve` (no trailing slash).
					url: v.optional(v.pipe(v.string(), v.url()), 'http://127.0.0.1:4096'),
					password: v.optional(v.pipe(v.string(), v.minLength(1))),
					// "<providerID>/<modelID>"; unset = opencode's default model.
					model: v.optional(v.pipe(v.string(), v.regex(OPENCODE_MODEL_PATTERN))),
					timeoutSeconds: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 300),
				}),
				{},
			),
			// Chat requests per user and window.
			rateLimit: v.optional(
				v.strictObject({
					maxRequests: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 30),
					windowSeconds: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 300),
				}),
				{},
			),
		}),
	),
	frontendUrl: v.optional(v.string()),
	integrations: v.optional(
		v.strictObject({
			// "offline" blocks every integration, "mock" serves captured snapshots instead.
			mode: v.optional(v.picklist(INTEGRATION_MODES), 'live'),
			// Snapshot files of the mock mode; relative to the data dir, or absolute.
			mockDir: v.optional(v.pipe(v.string(), v.minLength(1)), 'integrations-mock'),
		}),
		{},
	),
	storage: v.optional(
		v.strictObject({
			// Image attachments; relative to the data dir, or absolute.
			attachmentsDir: v.optional(v.pipe(v.string(), v.minLength(1)), 'attachments'),
		}),
		{},
	),
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
	let parsed: Record<string, unknown>
	try {
		parsed = Bun.TOML.parse(content) as Record<string, unknown>
	} catch {
		return Result.err(new Error(`Failed to parse TOML configuration at ${path}`))
	}

	// CONEX_INTEGRATIONS_MODE overrides `[integrations] mode`; validated below like the file.
	const modeOverride = getTrimmedEnv('CONEX_INTEGRATIONS_MODE')
	if (modeOverride !== undefined) {
		const section = parsed.integrations
		parsed.integrations = {
			...(typeof section === 'object' && section !== null ? section : {}),
			mode: modeOverride,
		}
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

/** True in `mock` mode: providers serve snapshots instead of contacting external systems. */
export function isMockMode(): boolean {
	return getConfig().integrations.mode === 'mock'
}

/**
 * Guards every outbound integration request: errs in `offline` and `mock` mode
 * so no request reaches `system`. Call it at each client's single network choke point.
 */
export function ensureIntegrationsLive(system: string): Result<void, Error> {
	const mode = getConfig().integrations.mode
	if (mode !== 'live') {
		const reason = mode === 'mock' ? 'mocked' : 'offline'
		return Result.err(
			new Error(
				`${system} is not contacted: integrations are ${reason} ([integrations] mode)`,
			),
		)
	}
	return Result.ok(undefined)
}
