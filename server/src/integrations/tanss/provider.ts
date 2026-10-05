import { Result } from 'better-result'
import type {
	DeviceInput,
	ExternalDevice,
	ExternalTenant,
	IntegrationProvider,
	TicketInput,
} from '../types'
import { type TanssCompany, type TanssCredentials, type TanssPc, TanssSession } from './client'

function toTenant(company: TanssCompany): ExternalTenant {
	return {
		external_id: String(company.id),
		display_id: company.displayId,
		name: company.name,
		active: !company.inactive && !company.lockout,
		private: company.private,
		headquarter_id: company.headquarterId === null ? null : String(company.headquarterId),
	}
}

function text(value: string | undefined): string | null {
	const trimmed = value?.trim() ?? ''
	return trimmed === '' ? null : trimmed
}

function toDevice(
	pc: TanssPc,
	companyId: string,
	manufacturers: Map<number, string>,
): ExternalDevice {
	const macs: string[] = []
	const ips: string[] = []
	for (const entry of pc.ips ?? []) {
		if (entry.mac) {
			macs.push(entry.mac)
		}
		if (entry.ip) {
			ips.push(entry.ip)
		}
	}
	return {
		external_id: `pc:${pc.id}`,
		external_tenant_id: companyId,
		kind: pc.server === true ? 'server' : 'pc',
		name: text(pc.name) ?? `#${pc.id}`,
		serial: text(pc.serialNumber),
		asset_tag: text(pc.inventoryNumber),
		manufacturer:
			pc.manufacturerId !== undefined ? (manufacturers.get(pc.manufacturerId) ?? null) : null,
		model: text(pc.model),
		macs,
		ips,
		active: pc.active !== false,
	}
}

/**
 * TANSS: tenant ↔ company (branches are companies of their own), device ↔
 * PC/server. Peripherals and components are out of scope for now.
 */
export class TanssProvider implements IntegrationProvider {
	readonly id = 'tanss' as const
	readonly tenantCardinality = 'one' as const
	private readonly session: TanssSession
	private manufacturers: Map<number, string> | null = null

	constructor(creds: TanssCredentials) {
		this.session = new TanssSession(creds)
	}

	async verify(): Promise<Result<void, Error>> {
		const login = await this.session.login()
		if (Result.isError(login)) {
			return login
		}
		const companies = await this.session.listCompanies()
		if (Result.isError(companies)) {
			return Result.err(new Error(`ERP token rejected: ${companies.error.message}`))
		}
		return Result.ok(undefined)
	}

	async listTenants(modifiedSince?: number): Promise<Result<ExternalTenant[], Error>> {
		const res = await this.session.listCompanies(modifiedSince)
		return res.map((companies) => companies.map(toTenant))
	}

	async fetchDevices(externalTenantId: string): Promise<Result<ExternalDevice[], Error>> {
		const companyId = Number(externalTenantId)
		if (!Number.isInteger(companyId)) {
			return Result.err(new Error(`Invalid TANSS company id ${externalTenantId}`))
		}
		const manufacturers = await this.manufacturerNames()
		if (Result.isError(manufacturers)) {
			return manufacturers
		}
		const pcs = await this.session.listPcs(companyId)
		return pcs.map((rows) =>
			rows
				.filter((pc) => pc.id !== undefined)
				.map((pc) => toDevice(pc, externalTenantId, manufacturers.value)),
		)
	}

	/** Manufacturer id → name, fetched once per provider instance. */
	private async manufacturerNames(): Promise<Result<Map<number, string>, Error>> {
		if (this.manufacturers === null) {
			const names = await this.session.manufacturerNames()
			if (Result.isError(names)) {
				return names
			}
			this.manufacturers = names.value
		}
		return Result.ok(this.manufacturers)
	}

	/** Creates a PC; the manufacturer is matched by name (case-insensitive). */
	async createDevice(input: DeviceInput): Promise<Result<ExternalDevice, Error>> {
		const companyId = Number(input.externalTenantId)
		if (!Number.isInteger(companyId)) {
			return Result.err(new Error(`Invalid TANSS company id ${input.externalTenantId}`))
		}
		const manufacturers = await this.manufacturerNames()
		if (Result.isError(manufacturers)) {
			return manufacturers
		}
		const wanted = input.manufacturer?.trim().toLowerCase()
		const manufacturerId = [...manufacturers.value].find(
			([, name]) => name.trim().toLowerCase() === wanted,
		)?.[0]
		const created = await this.session.createPc({
			companyId,
			name: input.name,
			active: input.active,
			server: input.server,
			...(input.serial !== null ? { serialNumber: input.serial } : {}),
			...(input.asset_tag !== null ? { inventoryNumber: input.asset_tag } : {}),
			...(input.model !== null ? { model: input.model } : {}),
			...(manufacturerId !== undefined ? { manufacturerId } : {}),
		})
		return created.map((pc) => toDevice(pc, input.externalTenantId, manufacturers.value))
	}

	async createTicket(input: TicketInput): Promise<Result<number, Error>> {
		const companyId = Number(input.externalTenantId)
		if (!Number.isInteger(companyId)) {
			return Result.err(new Error(`Invalid TANSS company id ${input.externalTenantId}`))
		}
		let pcId: number | undefined
		if (input.externalDeviceId !== undefined) {
			// Device links are `pc:<id>` (see `toDevice`).
			const match = /^pc:(\d+)$/.exec(input.externalDeviceId)
			if (!match) {
				return Result.err(new Error(`Invalid TANSS device id ${input.externalDeviceId}`))
			}
			pcId = Number(match[1])
		}
		return this.session.createTicket({
			companyId,
			...(pcId !== undefined ? { pcId } : {}),
			title: input.title,
			content: input.content,
		})
	}
}
