import { describe, expect, test } from "bun:test";
import {
	contactToEntry,
	escapeDnValue,
	isWithinScope,
	parentDn,
	slugify,
	splitName,
} from "./mapping.js";
import type { ContactRow } from "./types.js";

const BASE = "dc=conex,dc=local";

function row(over: Partial<ContactRow> = {}): ContactRow {
	return {
		id: "c-1",
		name: "Max Mustermann",
		firstName: "Max",
		lastName: "Mustermann",
		email: "max@mustermann.example",
		phone: "+49 30 123456",
		mobile: "+49 170 111222",
		title: "Geschäftsführer",
		clientId: "cl-1",
		clientName: "Muster GmbH",
		clientSlug: "muster-gmbh",
		siteId: "s-1",
		siteName: "Hauptstandort",
		...over,
	};
}

describe("contactToEntry", () => {
	test("maps all inetOrgPerson attributes", () => {
		const e = contactToEntry(row(), BASE);
		expect(e.dn).toBe("cn=Max Mustermann,ou=muster-gmbh,dc=conex,dc=local");
		expect(e.attributes.objectClass).toEqual([
			"top",
			"person",
			"organizationalPerson",
			"inetOrgPerson",
		]);
		expect(e.attributes.cn).toEqual(["Max Mustermann"]);
		expect(e.attributes.sn).toEqual(["Mustermann"]);
		expect(e.attributes.givenName).toEqual(["Max"]);
		expect(e.attributes.displayName).toEqual(["Max Mustermann"]);
		expect(e.attributes.mail).toEqual(["max@mustermann.example"]);
		expect(e.attributes.telephoneNumber).toEqual(["+49 30 123456"]);
		expect(e.attributes.mobile).toEqual(["+49 170 111222"]);
		expect(e.attributes.title).toEqual(["Geschäftsführer"]);
		expect(e.attributes.o).toEqual(["Muster GmbH"]);
		expect(e.attributes.company).toEqual(["Muster GmbH"]);
		expect(e.attributes.ou).toEqual(["Hauptstandort"]);
	});

	test("splits legacy single-name field when first/last are null", () => {
		const e = contactToEntry(
			row({ firstName: null, lastName: null, name: "Erika Schmidt" }),
			BASE,
		);
		expect(e.attributes.sn).toEqual(["Schmidt"]);
		expect(e.attributes.givenName).toEqual(["Erika"]);
	});

	test("falls back to client name for ou when no site is set", () => {
		const e = contactToEntry(row({ siteId: null, siteName: null }), BASE);
		expect(e.attributes.ou).toEqual(["Muster GmbH"]);
	});

	test("omits empty optional attributes", () => {
		const e = contactToEntry(
			row({
				email: null,
				phone: null,
				mobile: null,
				title: null,
				firstName: null,
				lastName: null,
				name: "Solo",
			}),
			BASE,
		);
		expect(e.attributes.mail).toBeUndefined();
		expect(e.attributes.telephoneNumber).toBeUndefined();
		expect(e.attributes.mobile).toBeUndefined();
		expect(e.attributes.title).toBeUndefined();
		expect(e.attributes.givenName).toBeUndefined();
		expect(e.attributes.sn).toEqual(["Solo"]);
	});

	test("escapes DN special chars", () => {
		const e = contactToEntry(
			row({ name: "Müller, Hans + Sohn", clientSlug: "m+l" }),
			BASE,
		);
		expect(e.dn).toBe(
			"cn=Müller\\, Hans \\+ Sohn,ou=m-l,dc=conex,dc=local",
		);
	});
});

describe("helpers", () => {
	test("slugify strips umlauts and punctuation", () => {
		expect(slugify("Muster GmbH")).toBe("muster-gmbh");
		expect(slugify("Müller & Söhne!")).toBe("muller-sohne");
	});
	test("splitName", () => {
		expect(splitName("Max Mustermann")).toEqual({
			firstName: "Max",
			lastName: "Mustermann",
		});
		expect(splitName("Dr. Max Mustermann")).toEqual({
			firstName: "Dr.",
			lastName: "Max Mustermann",
		});
		expect(splitName("Solo")).toEqual({ firstName: "", lastName: "Solo" });
	});
	test("escapeDnValue", () => {
		expect(escapeDnValue("a,b")).toBe("a\\,b");
		expect(escapeDnValue(" lead")).toBe("\\ lead");
	});
	test("parentDn respects escaped commas", () => {
		expect(parentDn("cn=a\\,b,ou=x,dc=y")).toBe("ou=x,dc=y");
		expect(parentDn("dc=y")).toBe("");
	});
	test("isWithinScope", () => {
		const dn = "cn=Max,ou=muster-gmbh,dc=conex,dc=local";
		expect(isWithinScope(dn, BASE, 2)).toBe(true);
		expect(isWithinScope(dn, "ou=muster-gmbh,dc=conex,dc=local", 1)).toBe(
			true,
		);
		expect(isWithinScope(dn, "ou=other,dc=conex,dc=local", 2)).toBe(false);
		expect(isWithinScope(dn, dn, 0)).toBe(true);
		expect(isWithinScope(dn, BASE, 0)).toBe(false);
	});
});
