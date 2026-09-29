import { Result } from 'better-result'
import type { ExternalDevice, ExternalTenant, IntegrationProvider } from '../types'
import { type TanssCompany, type TanssCredentials, type TanssPc, TanssSession } from './client'

function toTenant(company: TanssCompany): ExternalTenant {
	return {
		external_id: String(company.id),
		display_id: company.displayId,
		name: company.name,
		active: !company.inactive && !company.lockout,
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

	async listTenants(): Promise<Result<ExternalTenant[], Error>> {
		const res = await this.session.listCompanies()
		return res.map((companies) => companies.map(toTenant))
	}

	async fetchDevices(externalTenantId: string): Promise<Result<ExternalDevice[], Error>> {
		const companyId = Number(externalTenantId)
		if (!Number.isInteger(companyId)) {
			return Result.err(new Error(`Invalid TANSS company id ${externalTenantId}`))
		}
		if (this.manufacturers === null) {
			const names = await this.session.manufacturerNames()
			if (Result.isError(names)) {
				return names
			}
			this.manufacturers = names.value
		}
		const manufacturers = this.manufacturers
		const pcs = await this.session.listPcs(companyId)
		return pcs.map((rows) =>
			rows
				.filter((pc) => pc.id !== undefined)
				.map((pc) => toDevice(pc, externalTenantId, manufacturers)),
		)
	}
}
