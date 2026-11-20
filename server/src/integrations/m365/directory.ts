/**
 * Graph reads of one customer tenant: its organization and its member
 * users, mapped onto the normalized external records. The app needs the
 * application permissions `Organization.Read.All` and `User.Read.All`.
 *
 * SDK models type nearly every field as optional and nullable, so records
 * without an id are skipped and missing values become null.
 */
import '@microsoft/msgraph-sdk-organization'
import '@microsoft/msgraph-sdk-users'
import type { Organization, User } from '@microsoft/msgraph-sdk/models'
import { Result } from 'better-result'
import { type GraphApiError, GraphClient, type GraphCredentials } from '../../microsoft/graph'
import type { ExternalEmployee, ExternalTenant } from '../types'

const USER_FIELDS = [
	'id',
	'givenName',
	'surname',
	'displayName',
	'jobTitle',
	'mail',
	'userPrincipalName',
	'businessPhones',
	'mobilePhone',
	'accountEnabled',
	'assignedLicenses',
]

/** Organization of a tenant: name and domains. */
export interface M365Organization {
	ms_tenant_id: string
	display_name: string
	default_domain: string | null
	domains: string[]
}

function text(value: string | null | undefined): string | null {
	const trimmed = value?.trim()
	return trimmed ? trimmed : null
}

export function organizationOf(org: Organization): M365Organization | null {
	const id = text(org.id)?.toLowerCase()
	if (!id) {
		return null
	}
	const verified = org.verifiedDomains ?? []
	const domains = verified
		.map((d) => text(d.name)?.toLowerCase())
		.filter((d): d is string => d !== undefined && d !== null)
	const fallback = verified.find((d) => d.isDefault)?.name ?? domains[0] ?? null
	const defaultDomain = text(fallback)?.toLowerCase() ?? null
	return {
		ms_tenant_id: id,
		display_name: text(org.displayName) ?? defaultDomain ?? id,
		default_domain: defaultDomain,
		domains,
	}
}

export function tenantOf(org: M365Organization): ExternalTenant {
	return {
		external_id: org.ms_tenant_id,
		display_id: null,
		name: org.display_name,
		active: true,
		private: false,
		headquarter_id: null,
		domains: org.domains,
	}
}

/** Member user as an external employee; null without an object id. */
export function employeeOf(user: User, msTenantId: string): ExternalEmployee | null {
	const id = text(user.id)
	if (!id) {
		return null
	}
	const first = text(user.givenName)
	const last = text(user.surname)
	const display = text(user.displayName)
	const upn = text(user.userPrincipalName)
	const name = display ?? ([first, last].filter(Boolean).join(' ') || upn || id)
	return {
		external_id: id,
		external_tenant_id: msTenantId,
		external_tenant_ids: [msTenantId],
		name,
		first_name: first,
		// conex requires a last name: the display name stands in for one-word accounts.
		last_name: last ?? (first ? name : (display ?? upn ?? id)),
		salutation: null,
		title: text(user.jobTitle),
		email: (text(user.mail) ?? upn)?.toLowerCase() ?? null,
		phone: text(user.businessPhones?.[0]),
		mobile: text(user.mobilePhone),
		active: user.accountEnabled !== false,
	}
}

/** Graph access to one customer tenant with the MSP's app credentials. */
export class TenantDirectory {
	private readonly graph: GraphClient

	constructor(creds: GraphCredentials) {
		this.graph = new GraphClient(creds)
	}

	/** Proves the credentials work in the tenant (consent given). */
	async token(): Promise<Result<string, Error>> {
		return this.graph.token()
	}

	async organization(): Promise<Result<M365Organization, GraphApiError | Error>> {
		const orgs = await this.graph.getAll('organization read', this.graph.api.organization, {
			queryParameters: { select: ['id', 'displayName', 'verifiedDomains'] },
		})
		if (Result.isError(orgs)) {
			return orgs
		}
		const org = orgs.value.map(organizationOf).find((o) => o !== null)
		return org
			? Result.ok(org)
			: Result.err(new Error('Microsoft Graph returned no organization'))
	}

	/** Member users (no guests); `licensedOnly` drops accounts without a license. */
	async employees(
		msTenantId: string,
		licensedOnly: boolean,
	): Promise<Result<ExternalEmployee[], GraphApiError>> {
		const users = await this.graph.getAll('user list', this.graph.api.users, {
			queryParameters: { filter: "userType eq 'Member'", select: USER_FIELDS, top: 999 },
		})
		if (Result.isError(users)) {
			return users
		}
		return Result.ok(
			users.value
				.filter((user) => !licensedOnly || (user.assignedLicenses?.length ?? 0) > 0)
				.map((user) => employeeOf(user, msTenantId))
				.filter((e): e is ExternalEmployee => e !== null),
		)
	}
}
