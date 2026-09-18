import { Result } from 'better-result'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { AUDIT_SWEEP_INTERVAL_MS, pruneExpiredAuditLogs } from './audit'
import { type AppConfig, initConfig, load_config_file, resolve_listen_port } from './config'
import { initDb } from './db'
import { authApp } from './routes/auth'
import { deviceTypesApp } from './routes/device_types'
import { devicesApp } from './routes/devices'
import { locationsApp } from './routes/locations'
import { manufacturersApp } from './routes/manufacturers'
import { racksApp } from './routes/racks'
import { shelvesApp } from './routes/shelves'
import { sitesApp } from './routes/sites'
import { tenantGroupsApp } from './routes/tenant_groups'
import { tenantsApp } from './routes/tenants'
import { SESSION_SWEEP_INTERVAL_MS, sweepExpired } from './sessions'
import { jsonError } from './util/http'
import { start_sweep } from './util/periodic'
import { get_server_root, getTrimmedEnv, resolveInDataDir } from './util/server_root'

// Precedence for the config path:
// 1. CONEX_CONFIG_PATH env var (absolute, or relative to the data dir)
// 2. config.toml
function resolve_config_path(serverRoot: string): string {
	const configured_path = getTrimmedEnv('CONEX_CONFIG_PATH')
	if (!configured_path) {
		return resolveInDataDir(serverRoot, 'config.toml')
	}

	return resolveInDataDir(serverRoot, configured_path)
}

/**
 * Builds a fresh Hono application. No module-scope singleton: callers
 * (production startup, tests) get a clean instance with no shared state.
 * `AppType` stays derived from here so `client/src/api.ts` RPC typing is stable.
 */
// biome-ignore lint/nursery/useExplicitType: return type intentionally inferred —
// biome-ignore lint/nursery/useExplicitReturnType: naming it `: Hono` erases the chained-route generics that `hc<AppType>` depends on
export function createApp() {
	return (
		new Hono()
			// Aborted requests (e.g. a malformed JSON body rejected by a validator) must
			// answer with the same `{ error }` shape as the handlers, because that is the
			// only field the client reads.
			.onError((err, c) => {
				if (err instanceof HTTPException) {
					return jsonError(c, err.message, err.status)
				}

				console.error(err)
				return jsonError(c, 'Internal server error', 500)
			})
			.get('/health', (c) => {
				return c.json({ status: 'ok', version: '0.1.0' })
			})
			.route('/auth', authApp)
			.route('/tenant-groups', tenantGroupsApp)
			.route('/tenants', tenantsApp)
			.route('/sites', sitesApp)
			.route('/locations', locationsApp)
			.route('/racks', racksApp)
			.route('/shelves', shelvesApp)
			.route('/manufacturers', manufacturersApp)
			.route('/device-types', deviceTypesApp)
			.route('/devices', devicesApp)
	)
}

export type AppType = ReturnType<typeof createApp>

if (import.meta.main) {
	const rootRes = get_server_root()
	if (Result.isError(rootRes)) {
		console.error(`Failed to start server: ${rootRes.error.message}`)
		process.exit(1)
	}
	const serverRoot = Result.unwrap(rootRes)

	// Load and set
	const configResult = load_config_file(resolve_config_path(serverRoot))
	let config: AppConfig
	if (configResult.isOk()) {
		config = configResult.value
		initConfig(config)
	} else {
		console.error(`Failed to start server: ${configResult.error.message}`)
		process.exit(1)
	}

	try {
		initDb({ serverRoot })
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		console.error(`Failed to start server: ${msg}`)
		process.exit(1)
	}

	const app = createApp()

	// Drop timed out sessions even while nobody tries to use them.
	// Scheduled here and not at module scope, so it never keeps a test process alive.
	sweepExpired()
	start_sweep(sweepExpired, SESSION_SWEEP_INTERVAL_MS)

	// Prune audit log rows older than the configured retention (default 90 days).
	pruneExpiredAuditLogs()
	start_sweep(pruneExpiredAuditLogs, AUDIT_SWEEP_INTERVAL_MS)

	const server = Bun.serve({
		hostname: config.server.host,
		port: resolve_listen_port(config),
		fetch: app.fetch,
	})

	console.log(`API running on ${server.url}`)
}
