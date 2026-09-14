import * as v from "valibot";

export const ClientStatus = v.picklist(["active", "onboarding", "churned"]);

export type ClientStatusOutput = v.InferOutput<typeof ClientStatus>;

const slugField = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1),
  v.maxLength(255),
  v.regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase alphanumeric with single dashes",
  ),
);

const emailField = v.pipe(v.string(), v.trim(), v.email(), v.maxLength(255));

export const ClientCreate = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(255)),
  // Optional: derived from `name` when omitted.
  slug: v.optional(slugField),
  status: v.optional(ClientStatus, "active"),
  billingEmail: v.optional(v.nullable(emailField)),
  phone: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(64)))),
  notes: v.optional(v.nullable(v.string())),
});

export type ClientCreateInput = v.InferInput<typeof ClientCreate>;
export type ClientCreateOutput = v.InferOutput<typeof ClientCreate>;

export const ClientUpdate = v.object({
  name: v.optional(
    v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(255)),
  ),
  slug: v.optional(slugField),
  status: v.optional(ClientStatus),
  billingEmail: v.optional(v.nullable(emailField)),
  phone: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(64)))),
  notes: v.optional(v.nullable(v.string())),
});

export type ClientUpdateInput = v.InferInput<typeof ClientUpdate>;
export type ClientUpdateOutput = v.InferOutput<typeof ClientUpdate>;
