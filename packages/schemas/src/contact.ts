import * as v from "valibot";
import { paginationFields, Uuid } from "./common.js";

const emailField = v.pipe(v.string(), v.trim(), v.email(), v.maxLength(255));
const phoneField = v.pipe(v.string(), v.trim(), v.maxLength(64));
const namePart = v.pipe(v.string(), v.trim(), v.maxLength(120));

const baseContactFields = {
	firstName: v.optional(namePart),
	lastName: v.optional(namePart),
	// Display-name override; derived from first/last when omitted.
	name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(255))),
	email: v.optional(v.nullable(emailField)),
	// LDAP-relevant voice/mobile numbers.
	phone: v.optional(v.nullable(phoneField)),
	mobile: v.optional(v.nullable(phoneField)),
	title: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120))),
	),
	isPrimary: v.optional(v.boolean(), false),
};

// At least one of firstName / lastName / name is required so a
// person record always has something displayable (and LDAP-syncable).
// NOTE: the check callbacks are typed against the base object output
// so the action unifies with the full object in the v.pipe below.
const ContactCreateBase = v.object({
	...baseContactFields,
	// Assignment: clientId falls back to the `:id` path param on
	// nested routes; siteId null detaches from any site.
	clientId: v.optional(Uuid),
	siteId: v.optional(v.nullable(Uuid)),
});

type ContactCreateBaseOutput = v.InferOutput<typeof ContactCreateBase>;

function hasAnyName(c: ContactCreateBaseOutput): boolean {
	return Boolean(c.firstName?.trim() || c.lastName?.trim() || c.name?.trim());
}

export const ContactCreate = v.pipe(
	ContactCreateBase,
	v.check(hasAnyName, "One of firstName, lastName or name is required"),
);

export type ContactCreateInput = v.InferInput<typeof ContactCreate>;
export type ContactCreateOutput = v.InferOutput<typeof ContactCreate>;

export const ContactUpdate = v.object({
	...baseContactFields,
	clientId: v.optional(Uuid),
	siteId: v.optional(v.nullable(Uuid)),
});

export type ContactUpdateInput = v.InferInput<typeof ContactUpdate>;
export type ContactUpdateOutput = v.InferOutput<typeof ContactUpdate>;

// POST /contacts/:id/assign — move a person between clients/sites.
const ContactAssignBase = v.object({
	clientId: v.optional(Uuid),
	siteId: v.optional(v.nullable(Uuid)),
});

type ContactAssignBaseOutput = v.InferOutput<typeof ContactAssignBase>;

function hasAnyTarget(a: ContactAssignBaseOutput): boolean {
	return a.clientId !== undefined || a.siteId !== undefined;
}

export const ContactAssign = v.pipe(
	ContactAssignBase,
	v.check(hasAnyTarget, "One of clientId or siteId is required"),
);

export type ContactAssignInput = v.InferInput<typeof ContactAssign>;
export type ContactAssignOutput = v.InferOutput<typeof ContactAssign>;

// GET /contacts?clientId=&siteId=&q=&limit=&cursor=
export const ContactListQuery = v.object({
	...paginationFields,
	clientId: v.optional(Uuid),
	siteId: v.optional(Uuid),
});

export type ContactListQueryInput = v.InferInput<typeof ContactListQuery>;
export type ContactListQueryOutput = v.InferOutput<typeof ContactListQuery>;
