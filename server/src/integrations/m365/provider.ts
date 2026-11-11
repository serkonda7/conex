/**
 * Microsoft 365 as an integration provider: every consented customer
 * tenant (`m365_tenants`) is one external tenant, its member users are the
 * employees. Read-only toward M365 (no tickets, devices or pushes in phase 1).
 *
 * Tenants are fetched one after another. A tenant that fails keeps its last
 * snapshot (so its links do not turn stale) and records the error on its
 * row; the run only fails when every tenant failed.
 */
import { Result } from 'better-result'
import type { M365Settings } from 'shared/src/schemas'
import { readEmployees, readTenant } from '../snapshot'
import type {
	ExternalDevice,
	ExternalDirectory,
	ExternalEmployee,
	ExternalTenant,
	IntegrationProvider,
} from '../types'
import { type M365Organization, TenantDirectory, tenantOf } from './directory'
import { listM365TenantRows, recordM365Fetch } from './tenants'

export interface M365Credentials extends M365Settings {
	client_secret: string
}

export class M365Provider implements IntegrationProvider {
	readonly id = 'm365' as const

	constructor(private readonly creds: M365Credentials) {}

	/** Application id of the MSP's app (public; part of the consent link). */
	get clientId(): string {
		return this.creds.client_id
	}

	/** Graph access to one tenant with the MSP's app. */
	directory(msTenant: string): TenantDirectory {
		return new TenantDirectory({
			ms_tenant_id: msTenant,
			client_id: this.creds.client_id,
			client_secret: this.creds.client_secret,
		})
	}

	/** A token in the MSP's home tenant proves client id and secret. */
	async verify(): Promise<Result<void, Error>> {
		const token = await this.directory(this.creds.home_tenant).token()
		return token.map(() => undefined)
	}

	async listTenants(): Promise<Result<ExternalDirectory, Error>> {
		const rows = await listM365TenantRows()
		const tenants: ExternalTenant[] = []
		const employees: ExternalEmployee[] = []
		const errors: string[] = []
		for (const row of rows) {
			const id = row.ms_tenant_id
			const directory = this.directory(id)
			const fetched = await this.fetchTenant(directory, id)
			if (Result.isOk(fetched)) {
				await recordM365Fetch(id, { org: fetched.value.org })
				tenants.push(tenantOf(fetched.value.org))
				employees.push(...fetched.value.users)
				continue
			}
			const error = fetched.error.message
			await recordM365Fetch(id, { error })
			errors.push(`${row.display_name ?? id}: ${error}`)
			// Keep what the last good fetch saw.
			const previous = await readTenant('m365', id)
			tenants.push(
				previous ?? {
					external_id: id,
					display_id: null,
					name: row.display_name ?? id,
					active: true,
					private: false,
					headquarter_id: null,
				},
			)
			employees.push(...(await readEmployees('m365', id)))
		}
		if (rows.length > 0 && errors.length === rows.length) {
			return Result.err(new Error(errors.join('; ')))
		}
		return Result.ok({ tenants, employees })
	}

	private async fetchTenant(
		directory: TenantDirectory,
		id: string,
	): Promise<Result<{ org: M365Organization; users: ExternalEmployee[] }, Error>> {
		const org = await directory.organization()
		if (Result.isError(org)) {
			return org
		}
		const users = await directory.employees(id, this.creds.licensed_only)
		return users.map((list) => ({ org: org.value, users: list }))
	}

	/** Intune devices come in phase 2. */
	async fetchDevices(): Promise<Result<ExternalDevice[], Error>> {
		return Result.ok([])
	}
}
