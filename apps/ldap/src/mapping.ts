// Maps CONEX contacts to inetOrgPerson LDAP entries for the Agfeo TK
// telephone system address book.
import type { ContactRow, LdapEntry } from "./types.js";

/** URL/filesystem-safe slug, e.g. "Muster GmbH" -> "muster-gmbh". */
export function slugify(value: string): string {
	return (
		value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unknown"
	);
}

/** Escape a DN attribute value per RFC 4514 (minimal set). */
export function escapeDnValue(value: string): string {
	let out = value
		.replace(/\\/g, "\\\\")
		.replace(/,/g, "\\,")
		.replace(/\+/g, "\\+")
		.replace(/"/g, '\\"')
		.replace(/</g, "\\<")
		.replace(/>/g, "\\>")
		.replace(/;/g, "\\;");
	if (out.startsWith(" ") || out.startsWith("#")) out = `\\${out}`;
	if (out.endsWith(" ") && !out.endsWith("\\ "))
		out = `${out.slice(0, -1)}\\ `;
	return out;
}

/** Best-effort split of a display name into first/last parts. */
export function splitName(name: string): {
	firstName: string;
	lastName: string;
} {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { firstName: "", lastName: "" };
	if (parts.length === 1) return { firstName: "", lastName: parts[0] ?? "" };
	return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

function displayNameOf(contact: ContactRow): string {
	const fromName = contact.name.trim();
	if (fromName) return fromName;
	const joined = [contact.firstName, contact.lastName]
		.map((p) => (p ?? "").trim())
		.filter(Boolean)
		.join(" ");
	return joined || contact.email?.trim() || contact.id;
}

/**
 * Map one contact to an inetOrgPerson entry:
 *   dn: cn=<name>,ou=<client-slug>,<BASE_DN>
 */
export function contactToEntry(contact: ContactRow, baseDn: string): LdapEntry {
	const displayName = displayNameOf(contact);
	const split = splitName(displayName);
	const lastName = contact.lastName?.trim() || split.lastName || displayName;
	const firstName = contact.firstName?.trim() || split.firstName;
	const siteName = contact.siteName?.trim();

	const attributes: Record<string, string[]> = {
		objectClass: ["top", "person", "organizationalPerson", "inetOrgPerson"],
		cn: [displayName],
		sn: [lastName],
		displayName: [displayName],
		o: [contact.clientName],
		company: [contact.clientName],
		// Agfeo shows ou/department; fall back to the client name when the
		// contact has no site assigned.
		ou: [siteName || contact.clientName],
	};
	if (firstName) attributes.givenName = [firstName];
	if (contact.email?.trim()) attributes.mail = [contact.email.trim()];
	if (contact.phone?.trim())
		attributes.telephoneNumber = [contact.phone.trim()];
	if (contact.mobile?.trim()) attributes.mobile = [contact.mobile.trim()];
	if (contact.title?.trim()) attributes.title = [contact.title.trim()];

	const dn = `cn=${escapeDnValue(displayName)},ou=${escapeDnValue(
		slugify(contact.clientSlug || contact.clientName),
	)},${baseDn}`;
	return { dn, attributes };
}

/** Parent DN (respects \-escaped commas), "" when there is no parent. */
export function parentDn(dn: string): string {
	for (let i = 0; i < dn.length; i++) {
		const ch = dn[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === ",") return dn.slice(i + 1);
	}
	return "";
}

function dnEndsWith(entryDn: string, baseDn: string): boolean {
	const e = entryDn.toLowerCase();
	const b = baseDn.toLowerCase();
	return e === b || e.endsWith(`,${b}`);
}

/**
 * LDAP scope check (RFC 4511): 0=baseObject, 1=singleLevel, 2=wholeSubtree.
 */
export function isWithinScope(
	entryDn: string,
	baseDn: string,
	scope: number,
): boolean {
	if (baseDn === "") return true;
	if (scope === 0) return entryDn.toLowerCase() === baseDn.toLowerCase();
	if (!dnEndsWith(entryDn, baseDn)) return false;
	if (scope === 2) return true;
	return parentDn(entryDn).toLowerCase() === baseDn.toLowerCase();
}
