// Contact provider implementations: Postgres via @conex/db, or a JSON
// mock file (LDAP_MOCK_FILE) for tests and demos without a database.
import { readFile } from "node:fs/promises";
import { getDb, schema } from "@conex/db";
import { eq } from "drizzle-orm";
import type { LdapConfig } from "./config.js";
import type { ContactProvider } from "./ldap-server.js";
import type { ContactRow } from "./types.js";

export async function loadContactsFromDb(): Promise<ContactRow[]> {
	const db = getDb();
	const rows = await db
		.select({
			id: schema.contacts.id,
			name: schema.contacts.name,
			firstName: schema.contacts.firstName,
			lastName: schema.contacts.lastName,
			email: schema.contacts.email,
			phone: schema.contacts.phone,
			mobile: schema.contacts.mobile,
			title: schema.contacts.title,
			clientId: schema.contacts.clientId,
			siteId: schema.contacts.siteId,
			clientName: schema.clients.name,
			clientSlug: schema.clients.slug,
			siteName: schema.sites.name,
		})
		.from(schema.contacts)
		.innerJoin(
			schema.clients,
			eq(schema.contacts.clientId, schema.clients.id),
		)
		.leftJoin(schema.sites, eq(schema.contacts.siteId, schema.sites.id));
	return rows;
}

function isContactRow(value: unknown): value is ContactRow {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.id === "string" &&
		typeof v.name === "string" &&
		typeof v.clientId === "string" &&
		typeof v.clientName === "string" &&
		typeof v.clientSlug === "string"
	);
}

export async function loadContactsFromFile(
	path: string,
): Promise<ContactRow[]> {
	const raw = await readFile(path, "utf8");
	const data: unknown = JSON.parse(raw);
	const rows = Array.isArray(data) ? data : data ? [data] : [];
	const contacts = rows.filter(isContactRow);
	if (contacts.length !== rows.length) {
		throw new Error(
			`LDAP_MOCK_FILE ${path}: some entries are not valid contacts`,
		);
	}
	return contacts.map((c) => ({
		id: c.id,
		name: c.name,
		firstName: c.firstName ?? null,
		lastName: c.lastName ?? null,
		email: c.email ?? null,
		phone: c.phone ?? null,
		mobile: c.mobile ?? null,
		title: c.title ?? null,
		clientId: c.clientId,
		clientName: c.clientName,
		clientSlug: c.clientSlug,
		siteId: c.siteId ?? null,
		siteName: c.siteName ?? null,
	}));
}

export function createProvider(config: LdapConfig): ContactProvider {
	if (config.mockFile) {
		const path = config.mockFile;
		console.log(`[ldap] using mock contacts from ${path}`);
		return () => loadContactsFromFile(path);
	}
	if (!config.databaseUrl) {
		console.warn(
			"[ldap] DATABASE_URL not set, LDAP searches will return no entries",
		);
		return async () => [];
	}
	return () => loadContactsFromDb();
}
