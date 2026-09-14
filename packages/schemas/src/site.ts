import * as v from "valibot";
import { Uuid } from "./common.js";

export const SiteCreate = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(255)),
	addressLine1: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(255))),
	),
	city: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120))),
	),
	country: v.optional(
		v.nullable(
			v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(2)),
		),
	),
	timezone: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(64))),
	),
	isPrimary: v.optional(v.boolean(), false),
});

export type SiteCreateInput = v.InferInput<typeof SiteCreate>;
export type SiteCreateOutput = v.InferOutput<typeof SiteCreate>;

export const SiteUpdate = v.object({
	name: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(255)),
	),
	addressLine1: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(255))),
	),
	city: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(120))),
	),
	country: v.optional(
		v.nullable(
			v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(2)),
		),
	),
	timezone: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(64))),
	),
	isPrimary: v.optional(v.boolean()),
});

export type SiteUpdateInput = v.InferInput<typeof SiteUpdate>;
export type SiteUpdateOutput = v.InferOutput<typeof SiteUpdate>;

// Path params for nested /clients/:id/sites/:siteId routes.
export const ClientSiteParam = v.object({
	id: Uuid,
	siteId: Uuid,
});

export type ClientSiteParamOutput = v.InferOutput<typeof ClientSiteParam>;
