import { Result } from 'better-result'
import type {
	DeviceInput,
	DeviceUpdate,
	ExternalDevice,
	ExternalDirectory,
	ExternalEmployee,
	ExternalTenant,
	ExternalTicket,
	IntegrationProvider,
	TicketInput,
} from '../types'
import {
	PC_LINK_TYPE,
	PERIPHERY_LINK_TYPE,
	type TanssCompany,
	type TanssCredentials,
	type TanssEmployee,
	type TanssPc,
	type TanssPeriphery,
	TanssSession,
	type TanssTicket,
} from './client'

function toTenant(company: TanssCompany): ExternalTenant {
	return {
		external_id: String(company.id),
		display_id: company.displayId,
		name: company.name,
		active: company.active,
		private: company.private,
		headquarter_id: company.headquarterId === null ? null : String(company.headquarterId),
	}
}

function toEmployee(employee: TanssEmployee): ExternalEmployee {
	const companyIds = employee.companyIds.map(String)
	return {
		external_id: String(employee.id),
		external_tenant_id: companyIds[0] ?? null,
		external_tenant_ids: companyIds,
		name: [employee.firstName, employee.lastName].filter((p) => p !== null).join(' '),
		first_name: employee.firstName,
		last_name: employee.lastName,
		salutation: employee.salutation,
		title: employee.title,
		email: employee.email,
		phone: employee.phone,
		mobile: employee.mobile,
		active: employee.active,
	}
}

function text(value: string | undefined): string | null {
	const trimmed = value?.trim() ?? ''
	return trimmed === '' ? null : trimmed
}

function addresses(entries: TanssPc['ips']): { macs: string[]; ips: string[] } {
	const macs: string[] = []
	const ips: string[] = []
	for (const entry of entries ?? []) {
		if (entry.mac) {
			macs.push(entry.mac)
		}
		if (entry.ip) {
			ips.push(entry.ip)
		}
	}
	return { macs, ips }
}

function toDevice(
	pc: TanssPc,
	companyId: string,
	manufacturers: Map<number, string>,
): ExternalDevice {
	const { macs, ips } = addresses(pc.ips)
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

/** `type` is the free-text description TANSS shows in lists; used as model. */
function peripheryToDevice(
	periphery: TanssPeriphery,
	companyId: string,
	manufacturers: Map<number, string>,
): ExternalDevice {
	const { macs, ips } = addresses(periphery.ips)
	return {
		external_id: `periphery:${periphery.id}`,
		external_tenant_id: companyId,
		kind: 'periphery',
		name: text(periphery.name) ?? text(periphery.type) ?? `#${periphery.id}`,
		serial: text(periphery.serialNumber),
		asset_tag: text(periphery.inventoryNumber),
		manufacturer:
			periphery.manufacturerId !== undefined
				? (manufacturers.get(periphery.manufacturerId) ?? null)
				: null,
		model: text(periphery.type),
		macs,
		ips,
		active: periphery.active !== false,
	}
}

/** Last change is `modified`, else the last status change. */
function toTicket({ ticket, statusName }: TanssTicket): ExternalTicket {
	return {
		id: ticket.id ?? 0,
		title: text(ticket.title) ?? `#${ticket.id}`,
		status: statusName,
		created_at: ticket.creationDate ?? null,
		modified_at: ticket.modified ?? ticket.lastStateChangeDate ?? null,
	}
}

/** Device ids are `pc:<id>` or `periphery:<id>` (see `toDevice`). */
function parseDeviceId(
	externalId: string,
): Result<{ type: 'pc' | 'periphery'; id: number }, Error> {
	const match = /^(pc|periphery):(\d+)$/.exec(externalId)
	if (!match) {
		return Result.err(new Error(`Invalid TANSS device id ${externalId}`))
	}
	return Result.ok({ type: match[1] as 'pc' | 'periphery', id: Number(match[2]) })
}

/** Manufacturer id by name (case-insensitive). */
function manufacturerIdOf(
	manufacturers: Map<number, string>,
	name: string | null,
): number | undefined {
	const wanted = name?.trim().toLowerCase()
	return [...manufacturers].find(([, n]) => n.trim().toLowerCase() === wanted)?.[0]
}

/**
 * TANSS: tenant ↔ company (branches are companies of their own), device ↔
 * PC/server or periphery, employee ↔ employee (contact person) of the
 * company. Components are out of scope for now.
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
		const customers = await this.session.listCustomers()
		if (Result.isError(customers)) {
			return Result.err(new Error(`ERP token rejected: ${customers.error.message}`))
		}
		return Result.ok(undefined)
	}

	async listTenants(modifiedSince?: number): Promise<Result<ExternalDirectory, Error>> {
		const res = await this.session.listCustomers(modifiedSince)
		return res.map(({ companies, employees }) => ({
			tenants: companies.map(toTenant),
			employees: employees.map(toEmployee),
		}))
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
		if (Result.isError(pcs)) {
			return pcs
		}
		const peripheries = await this.session.listPeripheries(companyId)
		if (Result.isError(peripheries)) {
			return peripheries
		}
		return Result.ok([
			...pcs.value
				.filter((pc) => pc.id !== undefined)
				.map((pc) => toDevice(pc, externalTenantId, manufacturers.value)),
			...peripheries.value
				.filter((periphery) => periphery.id !== undefined)
				.map((periphery) =>
					peripheryToDevice(periphery, externalTenantId, manufacturers.value),
				),
		])
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
		const manufacturerId = manufacturerIdOf(manufacturers.value, input.manufacturer)
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
		let link: { typeId: number; id: number } | undefined
		if (input.externalDeviceId !== undefined) {
			const device = parseDeviceId(input.externalDeviceId)
			if (Result.isError(device)) {
				return device
			}
			link = {
				typeId: device.value.type === 'pc' ? PC_LINK_TYPE : PERIPHERY_LINK_TYPE,
				id: device.value.id,
			}
		}
		return this.session.createTicket({
			companyId,
			...(link !== undefined ? { link } : {}),
			title: input.title,
			content: input.content,
		})
	}

	async listTickets(externalTenantId: string): Promise<Result<ExternalTicket[], Error>> {
		const companyId = Number(externalTenantId)
		if (!Number.isInteger(companyId)) {
			return Result.err(new Error(`Invalid TANSS company id ${externalTenantId}`))
		}
		const res = await this.session.listOpenTickets(companyId)
		return res.map((tickets) => tickets.filter((t) => t.ticket.id !== undefined).map(toTicket))
	}

	/**
	 * Read-modify-write: TANSS replaces the whole object on update, so the
	 * current one is fetched and only the given fields are changed. A
	 * periphery's model is its `type`.
	 */
	async updateDevice(
		externalId: string,
		changes: DeviceUpdate,
	): Promise<Result<ExternalDevice, Error>> {
		const device = parseDeviceId(externalId)
		if (Result.isError(device)) {
			return device
		}
		const manufacturers = await this.manufacturerNames()
		if (Result.isError(manufacturers)) {
			return manufacturers
		}
		let manufacturerId: number | undefined
		if (changes.manufacturer !== undefined) {
			manufacturerId = manufacturerIdOf(manufacturers.value, changes.manufacturer)
			if (manufacturerId === undefined) {
				return Result.err(
					new Error(`Manufacturer "${changes.manufacturer}" does not exist in TANSS`),
				)
			}
		}
		const common = {
			...(changes.name !== undefined ? { name: changes.name } : {}),
			...(manufacturerId !== undefined ? { manufacturerId } : {}),
		}
		const { id } = device.value
		if (device.value.type === 'pc') {
			const current = await this.session.getPc(id)
			if (Result.isError(current)) {
				return current
			}
			// Details are read-only lists, not part of the update body.
			const { serviceIcons, components, peripheries, softwarelicenses, ...pc } = current.value
			const updated = await this.session.updatePc(id, {
				...pc,
				...common,
				...(changes.model !== undefined ? { model: changes.model } : {}),
			})
			return updated.map((row) =>
				toDevice(row, String(row.companyId ?? pc.companyId), manufacturers.value),
			)
		}
		const current = await this.session.getPeriphery(id)
		if (Result.isError(current)) {
			return current
		}
		const updated = await this.session.updatePeriphery(id, {
			...current.value,
			...common,
			...(changes.model !== undefined ? { type: changes.model } : {}),
		})
		return updated.map((row) =>
			peripheryToDevice(
				row,
				String(row.companyId ?? current.value.companyId),
				manufacturers.value,
			),
		)
	}
}
