// Contact row as read from Postgres (contacts JOIN clients/sites).
// Mirrors packages/db/src/schema.ts column names.
export interface ContactRow {
	id: string;
	name: string;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	phone: string | null;
	mobile: string | null;
	title: string | null;
	clientId: string;
	clientName: string;
	clientSlug: string;
	siteId: string | null;
	siteName: string | null;
}

// LDAP entry ready to be encoded as a SearchResultEntry.
export interface LdapEntry {
	dn: string;
	/** Attribute name (canonical case) -> values. */
	attributes: Record<string, string[]>;
}
