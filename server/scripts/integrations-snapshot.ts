/**
 * Captures normalized data of every enabled integration into snapshot files
 * for the `mock` integration mode. Run on a LIVE instance; the snapshots hold
 * customer data and belong in `data/` (already gitignored). Copy them to the
 * dev instance's `<data dir>/integrations-mock/` directory.
 *
 *   bun run integrations:snapshot [--provider <id>] [--out <dir>]
 *
 * Per-tenant fetches run sequentially to avoid hammering the external APIs.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { Result } from 'better-result'
import {
	IntegrationProviderSchema,
	type IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { getConfig, initConfig, load_config_file } from '../src/config'
import { initDb } from '../src/db/connection'
import { mockDirPath, type Snapshot, SnapshotSchema } from '../src/integrations/mock'
import { providerDefinition } from '../src/integrations/registry'
import { getIntegrationRow, listIntegrations, providerFor } from '../src/integrations/store'
import type { ExternalDevice, ExternalTag, ExternalTicket } from '../src/integrations/types'
import { get_server_root, getTrimmedEnv, resolveInDataDir } from '../src/util/server_root'

interface Options {
	provider?: ProviderId
	out?: string
}

function parseArgs(argv: string[]): Result<Options, Error> {
	const parsed: Options = {}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg !== '--provider' && arg !== '--out') {
			return Result.err(
				new Error(`Unknown argument "${arg}" (use --provider <id> and --out <dir>)`),
			)
		}
		const value = argv[++i]
		if (value === undefined) {
			return Result.err(new Error(`Missing value for ${arg}`))
		}
		if (arg === '--out') {
			parsed.out = value
			continue
		}
		const provider = v.safeParse(IntegrationProviderSchema, value)
		if (!provider.success) {
			return Result.err(new Error(`Unknown provider "${value}"`))
		}
		parsed.provider = provider.output
	}
	return Result.ok(parsed)
}

/** Captures one provider; errors become `Result`s so the caller can continue. */
async function captureProvider(provider: ProviderId, outDir: string): Promise<Result<void, Error>> {
	const row = await getIntegrationRow(provider)
	if (Result.isError(row)) {
		return row
	}
	const built = providerFor(row.value)
	if (Result.isError(built)) {
		return built
	}
	const instance = built.value
	const capabilities = providerDefinition(provider).capabilities
	const directory = await instance.listTenants()
	if (Result.isError(directory)) {
		return directory
	}
	const devices: Record<string, ExternalDevice[]> = {}
	const tickets: Record<string, ExternalTicket[]> = {}
	let deviceCount = 0
	let ticketCount = 0
	for (const tenant of directory.value.tenants) {
		const fetched = await instance.fetchDevices(tenant.external_id)
		if (Result.isError(fetched)) {
			return fetched
		}
		devices[tenant.external_id] = fetched.value
		deviceCount += fetched.value.length
		if (!capabilities.tickets || !instance.listTickets) {
			continue
		}
		const listed = await instance.listTickets(tenant.external_id)
		if (Result.isError(listed)) {
			return listed
		}
		tickets[tenant.external_id] = listed.value
		ticketCount += listed.value.length
	}
	let tags: ExternalTag[] | undefined
	if (capabilities.tickets && instance.listTags) {
		const listed = await instance.listTags()
		if (Result.isError(listed)) {
			return listed
		}
		tags = listed.value
	}
	const snapshot: Snapshot = {
		version: 1,
		provider,
		captured_at: new Date().toISOString(),
		directory: directory.value,
		devices,
		...(capabilities.tickets ? { tickets } : {}),
		...(tags === undefined ? {} : { tags }),
	}
	const validated = v.safeParse(SnapshotSchema, snapshot)
	if (!validated.success) {
		return Result.err(
			new Error(
				`Captured data is invalid: ${validated.issues[0]?.message ?? 'unknown error'}`,
			),
		)
	}
	const file = path.join(outDir, `${provider}.json`)
	const saved = await Result.tryPromise({
		try: async () => {
			await fs.mkdir(outDir, { recursive: true, mode: 0o700 })
			await fs.writeFile(file, `${JSON.stringify(validated.output, null, 2)}\n`, {
				encoding: 'utf8',
				mode: 0o600,
			})
		},
		catch: (e: unknown) =>
			new Error(`Failed to write ${file}: ${e instanceof Error ? e.message : String(e)}`),
	})
	if (Result.isError(saved)) {
		return saved
	}
	console.log(
		`  ${provider}: ${directory.value.tenants.length} tenants, ${deviceCount} devices, ${ticketCount} tickets -> ${file}`,
	)
	return Result.ok(undefined)
}

async function main(): Promise<void> {
	const root = get_server_root()
	if (Result.isError(root)) {
		console.error(`Failed to capture snapshots: ${root.error.message}`)
		process.exit(1)
	}
	const serverRoot = root.value
	const configRes = load_config_file(
		resolveInDataDir(serverRoot, getTrimmedEnv('CONEX_CONFIG_PATH') ?? 'config.toml'),
	)
	if (Result.isError(configRes)) {
		console.error(`Failed to capture snapshots: ${configRes.error.message}`)
		process.exit(1)
	}
	initConfig(configRes.value)
	const mode = getConfig().integrations.mode
	if (mode !== 'live') {
		console.error(
			`Snapshots can only be captured in live mode (current mode: ${mode}). Run this on a live instance.`,
		)
		process.exit(1)
	}
	const args = parseArgs(process.argv.slice(2))
	if (Result.isError(args)) {
		console.error(args.error.message)
		process.exit(1)
	}
	try {
		await initDb({ serverRoot })
	} catch (e) {
		console.error(`Failed to open database: ${e instanceof Error ? e.message : String(e)}`)
		process.exit(1)
	}
	const outDir = mockDirPath(serverRoot, args.value.out)
	const selected = (await listIntegrations()).filter(
		(integration) =>
			integration.enabled &&
			(args.value.provider === undefined || integration.provider === args.value.provider),
	)
	if (selected.length === 0) {
		const detail = args.value.provider ? ` for ${args.value.provider}` : ''
		console.error(`No enabled integration${detail} to capture`)
		process.exit(1)
	}
	let failed = 0
	for (const integration of selected) {
		console.log(`Capturing ${integration.provider}...`)
		const result = await captureProvider(integration.provider, outDir)
		if (Result.isError(result)) {
			failed++
			console.error(`  FAILED: ${result.error.message}`)
		}
	}
	if (failed > 0) {
		console.error(`${failed} of ${selected.length} integration(s) failed`)
		process.exit(1)
	}
	console.log(`Captured ${selected.length} integration(s) to ${outDir}`)
}

if (import.meta.main) {
	await main()
}
