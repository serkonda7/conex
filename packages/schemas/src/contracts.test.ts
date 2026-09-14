import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import {
	ClientCreate,
	ClientUpdate,
	ContactAssign,
	ContactCreate,
	ContactListQuery,
	ContactUpdate,
	PaginationQuery,
	SiteCreate,
	SiteUpdate,
} from "./index.js";

describe("ClientCreate", () => {
	test("accepts minimal payload, defaults status to active", () => {
		const out = v.parse(ClientCreate, { name: "Acme" });
		expect(out.status).toBe("active");
		expect(out.name).toBe("Acme");
	});

	test("rejects empty name", () => {
		expect(() => v.parse(ClientCreate, { name: "  " })).toThrow();
	});

	test("rejects bad status", () => {
		expect(() =>
			v.parse(ClientCreate, { name: "Acme", status: "deleted" }),
		).toThrow();
	});

	test("rejects invalid billing email", () => {
		expect(() =>
			v.parse(ClientCreate, {
				name: "Acme",
				billingEmail: "not-an-email",
			}),
		).toThrow();
	});

	test("accepts null billing email (clears field)", () => {
		const out = v.parse(ClientCreate, {
			name: "Acme",
			billingEmail: null,
		});
		expect(out.billingEmail).toBeNull();
	});

	test("rejects malformed slug", () => {
		expect(() =>
			v.parse(ClientCreate, { name: "Acme", slug: "Bad Slug!" }),
		).toThrow();
	});
});

describe("ClientUpdate", () => {
	test("accepts partial payload", () => {
		const out = v.parse(ClientUpdate, { phone: "+49 30 1" });
		expect(out.phone).toBe("+49 30 1");
		expect(out.name).toBeUndefined();
	});
});

describe("SiteCreate / SiteUpdate", () => {
	test("accepts minimal site", () => {
		const out = v.parse(SiteCreate, { name: "HQ" });
		expect(out.isPrimary).toBe(false);
	});

	test("rejects 3-letter country code", () => {
		expect(() =>
			v.parse(SiteCreate, { name: "HQ", country: "DEU" }),
		).toThrow();
	});

	test("accepts partial site update", () => {
		expect(() => v.parse(SiteUpdate, { city: "Berlin" })).not.toThrow();
	});
});

describe("ContactCreate", () => {
	const uuid = "123e4567-e89b-12d3-a456-426614174000";

	test("accepts first/last + LDAP fields", () => {
		const out = v.parse(ContactCreate, {
			firstName: "Ada",
			lastName: "Lovelace",
			email: "ada@acme.example",
			phone: "+49 30 1",
			mobile: "+49 170 1",
		});
		expect(out.email).toBe("ada@acme.example");
	});

	test("rejects contact with no name at all", () => {
		expect(() => v.parse(ContactCreate, { email: "x@y.zz" })).toThrow();
	});

	test("accepts assignment fields clientId + nullable siteId", () => {
		const out = v.parse(ContactCreate, {
			name: "Helpdesk",
			clientId: uuid,
			siteId: null,
		});
		expect(out.clientId).toBe(uuid);
		expect(out.siteId).toBeNull();
	});

	test("rejects malformed siteId", () => {
		expect(() =>
			v.parse(ContactCreate, { name: "Helpdesk", siteId: "nope" }),
		).toThrow();
	});

	test("rejects invalid email", () => {
		expect(() =>
			v.parse(ContactCreate, { firstName: "Ada", email: "bad" }),
		).toThrow();
	});
});

describe("ContactUpdate / ContactAssign", () => {
	test("update accepts empty object (handler returns 400, not validator)", () => {
		expect(() => v.parse(ContactUpdate, {})).not.toThrow();
	});

	test("assign requires at least one of clientId/siteId", () => {
		expect(() => v.parse(ContactAssign, {})).toThrow();
		expect(() => v.parse(ContactAssign, { siteId: null })).not.toThrow();
	});
});

describe("pagination / list queries", () => {
	test("limit parses from query string", () => {
		const out = v.parse(PaginationQuery, { limit: "20" });
		expect(out.limit).toBe(20);
	});

	test("limit rejects out-of-range values", () => {
		expect(() => v.parse(PaginationQuery, { limit: "0" })).toThrow();
		expect(() => v.parse(PaginationQuery, { limit: "101" })).toThrow();
		expect(() => v.parse(PaginationQuery, { limit: "abc" })).toThrow();
	});

	test("contact list query accepts filters", () => {
		const uuid = "123e4567-e89b-12d3-a456-426614174000";
		const out = v.parse(ContactListQuery, {
			clientId: uuid,
			q: "ada",
			limit: "10",
		});
		expect(out.clientId).toBe(uuid);
		expect(out.limit).toBe(10);
	});
});
