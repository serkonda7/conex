/**
 * Mock integration mode: providers serve data captured from the live system
 * instead of making any outbound request. Snapshots live outside the database
 * in `<data dir>/[integrations] mockDir/<provider>.json` and are validated on
 * load. Writes mutate an in-memory copy for the process lifetime only; the
 * captured file is never touched.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Result } from 'better-result'
import {
	EmployeeSalutationSchema,
	type ExternalDeviceJson,
	type IntegrationCapabilities,
	IntegrationProviderSchema,
	type IntegrationProvider as ProviderId,
} from 'shared/src/schemas'
import * as v from 'valibot'
import { getConfig, isMockMode } from '../config'
import { get_server_root, resolveInDataDir } from '../util/server_root'
import { nowSeconds } from '../util/time'
import { formatValibotIssues } from '../util/valibot'
import { providerDefinition } from './registry'
import type { IntegrationSecrets } from './secrets'
import type {
	DeviceInput,
	DeviceUpdate,
	EmployeeUpdate,
	ExternalDirectory,
	ExternalTag,
	ExternalTicket,
	IntegrationConfig,
	IntegrationProvider,
	TicketInput,
} from './types'

const ExternalTenantSchema = v.object({
	external_id: v.string(),
	display_id: v.nullable(v.string()),
	name: v.string(),
	active: v.boolean(),
	private: v.boolean(),
	headquarter_id: v.nullable(v.string()),
	domains: v.optional(v.array(v.string())),
})

const ExternalEmployeeSchema = v.object({
	external_id: v.string(),
	external_tenant_id: v.nullable(v.string()),
	external_tenant_ids: v.array(v.string()),
	name: v.string(),
	first_name: v.nullable(v.string()),
	last_name: v.string(),
	salutation: v.nullable(EmployeeSalutationSchema),
	title: v.nullable(v.string()),
	email: v.nullable(v.string()),
	phone: v.nullable(v.string()),
	mobile: v.nullable(v.string()),
	active: v.boolean(),
})

const ExternalDeviceSchema = v.object({
	external_id: v.string(),
	external_tenant_id: v.string(),
	kind: v.string(),
	name: v.string(),
	serial: v.nullable(v.string()),
	asset_tag: v.nullable(v.string()),
	manufacturer: v.nullable(v.string()),
	model: v.nullable(v.string()),
	macs: v.array(v.string()),
	ips: v.array(v.string()),
	active: v.boolean(),
})

/** Normalized ticket without the locally resolved priority (see `ExternalTicket`). */
const ExternalTicketSchema = v.object({
	id: v.number(),
	title: v.string(),
	status: v.nullable(v.string()),
	created_at: v.nullable(v.number()),
	modified_at: v.nullable(v.number()),
	tags: v.array(v.string()),
})

const ExternalTagSchema = v.object({
	external_id: v.string(),
	name: v.string(),
})

const ExternalDirectorySchema = v.object({
	tenants: v.array(ExternalTenantSchema),
	employees: v.array(ExternalEmployeeSchema),
})

/** Shape of one `<mockDir>/<provider>.json` file. */
export const SnapshotSchema = v.object({
	version: v.literal(1),
	provider: IntegrationProviderSchema,
	captured_at: v.string(),
	directory: ExternalDirectorySchema,
	devices: v.record(v.string(), v.array(ExternalDeviceSchema)),
	tickets: v.optional(v.record(v.string(), v.array(ExternalTicketSchema))),
	tags: v.optional(v.array(ExternalTagSchema)),
})

export type Snapshot = v.InferOutput<typeof SnapshotSchema>

/** One loaded snapshot plus the counters of its in-memory writes. */
interface MockState {
	snapshot: Snapshot
	nextTicketId: number
	nextDevice: number
}

/** Loaded snapshots, kept for the process lifetime so UI writes stay visible. */
const states = new Map<ProviderId, MockState>()

const PROVIDER_LABELS: Record<ProviderId, string> = {
	tanss: 'TANSS',
	octoja: 'Octoja',
	unifi: 'UniFi',
	m365: 'Microsoft 365',
}

/** Absolute path of the snapshot directory; `override` is for the capture script. */
export function mockDirPath(serverRoot: string, override?: string): string {
	return resolveInDataDir(serverRoot, override ?? getConfig().integrations.mockDir)
}

function snapshotPath(provider: ProviderId): Result<string, Error> {
	const root = get_server_root()
	if (Result.isError(root)) {
		return root
	}
	return Result.ok(path.join(mockDirPath(root.value), `${provider}.json`))
}

/** Loads and validates a snapshot once, then returns the mutable in-memory copy. */
function loadSnapshot(provider: ProviderId): Result<MockState, Error> {
	const existing = states.get(provider)
	if (existing) {
		return Result.ok(existing)
	}
	const filePath = snapshotPath(provider)
	if (Result.isError(filePath)) {
		return filePath
	}
	const label = PROVIDER_LABELS[provider]
	if (!fs.existsSync(filePath.value)) {
		return Result.err(
			new Error(
				`No mock data for ${label}: ${filePath.value} missing (run bun run integrations:snapshot on a live instance)`,
			),
		)
	}
	const json = Result.try({
		try: (): unknown => JSON.parse(fs.readFileSync(filePath.value, 'utf8')) as unknown,
		catch: (): Error =>
			new Error(`Mock data for ${label} at ${filePath.value} is not valid JSON`),
	})
	if (Result.isError(json)) {
		return json
	}
	const parsed = v.safeParse(SnapshotSchema, json.value)
	if (!parsed.success) {
		return Result.err(
			new Error(
				`Invalid mock data for ${label} at ${filePath.value}: ${formatValibotIssues(parsed.issues)}`,
			),
		)
	}
	if (parsed.output.provider !== provider) {
		return Result.err(
			new Error(
				`Mock data for ${label} at ${filePath.value} is for provider ${parsed.output.provider}`,
			),
		)
	}
	const snapshot: Snapshot = structuredClone(parsed.output)
	let maxTicketId = 0
	for (const list of Object.values(snapshot.tickets ?? {})) {
		for (const ticket of list) {
			maxTicketId = Math.max(maxTicketId, ticket.id)
		}
	}
	const state: MockState = { snapshot, nextTicketId: maxTicketId + 1, nextDevice: 1 }
	states.set(provider, state)
	return Result.ok(state)
}

/**
 * Creates a provider that only reads the snapshot and keeps writes in memory.
 * Optional methods are exposed only where the real definition declares the
 * capability, so routes gate features exactly as they do in live mode.
 */
export function mockProvider(provider: ProviderId): IntegrationProvider {
	const capabilities: IntegrationCapabilities = providerDefinition(provider).capabilities
	const instance: IntegrationProvider = {
		id: provider,
		verify: async (): Promise<Result<void, Error>> =>
			loadSnapshot(provider).map(() => undefined),
		listTenants: async (_modifiedSince?: number): Promise<Result<ExternalDirectory, Error>> =>
			loadSnapshot(provider).map((state) => state.snapshot.directory),
		fetchDevices: async (
			externalTenantId: string,
		): Promise<Result<ExternalDeviceJson[], Error>> =>
			loadSnapshot(provider).map((state) => state.snapshot.devices[externalTenantId] ?? []),
	}
	if (capabilities.tickets) {
		instance.listTickets = async (
			externalTenantId: string,
		): Promise<Result<ExternalTicket[], Error>> =>
			loadSnapshot(provider).map((state) => state.snapshot.tickets?.[externalTenantId] ?? [])
		instance.listTags = async (): Promise<Result<ExternalTag[], Error>> =>
			loadSnapshot(provider).map((state) => state.snapshot.tags ?? [])
		instance.createTicket = async (input: TicketInput): Promise<Result<number, Error>> =>
			loadSnapshot(provider).map((state) => {
				const id = state.nextTicketId++
				const ticket: ExternalTicket = {
					id,
					title: input.title,
					status: null,
					created_at: nowSeconds(),
					modified_at: nowSeconds(),
					// A priority label is a ticket tag; `withPriorities` resolves it locally.
					tags: input.priority === undefined ? [] : [input.priority],
				}
				const tickets = state.snapshot.tickets ?? {}
				tickets[input.externalTenantId] = [
					...(tickets[input.externalTenantId] ?? []),
					ticket,
				]
				state.snapshot.tickets = tickets
				return id
			})
	}
	if (capabilities.push) {
		instance.updateDevice = async (
			externalId: string,
			changes: DeviceUpdate,
		): Promise<Result<ExternalDeviceJson, Error>> => {
			const state = loadSnapshot(provider)
			if (Result.isError(state)) {
				return state
			}
			for (const list of Object.values(state.value.snapshot.devices)) {
				const device = list.find(
					(row: ExternalDeviceJson) => row.external_id === externalId,
				)
				if (device) {
					if (changes.name !== undefined) {
						device.name = changes.name
					}
					if (changes.manufacturer !== undefined) {
						device.manufacturer = changes.manufacturer
					}
					if (changes.model !== undefined) {
						device.model = changes.model
					}
					return Result.ok(device)
				}
			}
			return Result.err(new Error(`Mock device ${externalId} not found`))
		}
		instance.updateEmployee = async (
			externalId: string,
			changes: EmployeeUpdate,
		): Promise<Result<void, Error>> => {
			const state = loadSnapshot(provider)
			if (Result.isError(state)) {
				return state
			}
			const employee = state.value.snapshot.directory.employees.find(
				(row) => row.external_id === externalId,
			)
			if (!employee) {
				return Result.err(new Error(`Mock employee ${externalId} not found`))
			}
			if (changes.first_name !== undefined) {
				employee.first_name = changes.first_name
			}
			if (changes.last_name !== undefined) {
				employee.last_name = changes.last_name
			}
			if (changes.email !== undefined) {
				employee.email = changes.email
			}
			if (changes.phone !== undefined) {
				employee.phone = changes.phone
			}
			if (changes.mobile !== undefined) {
				employee.mobile = changes.mobile
			}
			if (changes.active !== undefined) {
				employee.active = changes.active
			}
			return Result.ok(undefined)
		}
	}
	if (capabilities.create_device) {
		instance.createDevice = async (
			input: DeviceInput,
		): Promise<Result<ExternalDeviceJson, Error>> =>
			loadSnapshot(provider).map((state) => {
				const device: ExternalDeviceJson = {
					external_id: `mock-${state.nextDevice++}`,
					external_tenant_id: input.externalTenantId,
					kind: 'pc',
					name: input.name,
					serial: input.serial,
					asset_tag: input.asset_tag,
					manufacturer: input.manufacturer,
					model: input.model,
					macs: [],
					ips: [],
					active: input.active,
				}
				const devices = state.snapshot.devices[input.externalTenantId] ?? []
				state.snapshot.devices[input.externalTenantId] = [...devices, device]
				return device
			})
	}
	return instance
}

/**
 * The single place where a provider instance is built: `mock` mode returns the
 * snapshot-backed provider without needing any credentials, live/offline use
 * the real definition (offline is stopped at each network choke point).
 */
export function buildProvider(
	provider: ProviderId,
	config: IntegrationConfig,
	secrets: IntegrationSecrets,
): Result<IntegrationProvider, Error> {
	if (isMockMode()) {
		return Result.ok(mockProvider(provider))
	}
	return providerDefinition(provider).build(config, secrets)
}
