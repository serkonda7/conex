// Runtime configuration for the LDAP bridge. Everything comes from the
// environment so the same image runs in docker-compose and locally.
export interface LdapConfig {
	baseDn: string;
	bindDn: string;
	bindPassword: string;
	allowAnonymous: boolean;
	ldapPort: number;
	httpPort: number;
	/** Max entries per LDAP search response (Agfeo pages through these). */
	sizeLimit: number;
	databaseUrl: string | undefined;
	/** Optional JSON file with ContactRow[] used instead of Postgres (tests). */
	mockFile: string | undefined;
}

function num(value: string | undefined, fallback: number): number {
	const n = Number(value ?? fallback);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LdapConfig {
	return {
		baseDn: env.LDAP_BASE_DN ?? "dc=conex,dc=local",
		bindDn: env.LDAP_BIND_DN ?? "cn=admin,dc=conex,dc=local",
		bindPassword: env.LDAP_BIND_PASSWORD ?? "secret",
		allowAnonymous:
			(env.LDAP_ALLOW_ANONYMOUS ?? "true").toLowerCase() !== "false",
		ldapPort: num(env.LDAP_PORT, 1389),
		httpPort: num(env.LDAP_HTTP_PORT, 3002),
		sizeLimit: num(env.LDAP_SIZE_LIMIT, 50),
		databaseUrl: env.DATABASE_URL,
		mockFile: env.LDAP_MOCK_FILE || undefined,
	};
}
