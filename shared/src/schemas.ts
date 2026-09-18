/**
 * Runtime contracts for everything a client may send to the API.
 *
 * The TypeScript types are derived from these schemas instead of being written
 * by hand, so the runtime check and the compile-time type cannot drift apart.
 *
 * P0 placeholder: only auth + shared list contracts exist. Domain schemas
 * (tenants, sites, racks, devices, cables) are added in P1-P5.
 */
import * as v from 'valibot'

// Local-login credentials. strictObject so unknown keys fail loudly instead
// of being stripped; the route validator reports them through the shared
// onValidationError hook.
export const LoginSchema = v.strictObject({
	email: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(320)),
	password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
})

export type Login = v.InferInput<typeof LoginSchema>

// Shared list-query contract (?search=&page=&limit=) used by every P1+
// list endpoint. Defaults keep callers from re-declaring pagination math.
export const ListQuerySchema = v.strictObject({
	search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
	page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
	limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
})

export type ListQuery = v.InferInput<typeof ListQuerySchema>

// ---------------------------------------------------------------------------
// P1: tenants / sites / locations
// ---------------------------------------------------------------------------

/** URL-safe identifier: lowercase alphanumerics separated by single dashes. */
export const SlugSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(100),
	v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase letters, digits, or single dashes'),
)

export const NameSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100))

export const DescriptionSchema = v.optional(
	v.pipe(v.string(), v.trim(), v.maxLength(500)),
	undefined,
)

export const IdSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100))

/** Nullable FK field: accepts a missing key, null, or a non-empty id. */
const NullableIdSchema = v.optional(v.nullable(IdSchema), undefined)

/** Maximum nesting depth of the location tree (root counts as depth 1). */
export const MAX_LOCATION_DEPTH = 5

export const TenantGroupCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	description: DescriptionSchema,
})

export const TenantGroupUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export const TenantCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	group_id: NullableIdSchema,
	description: DescriptionSchema,
})

export const TenantUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	group_id: v.optional(v.nullable(IdSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export const SiteCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	tenant_id: NullableIdSchema,
	// v1 keeps the site group as a free-form label, not a FK.
	group: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), undefined),
	description: DescriptionSchema,
})

export const SiteUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	group: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export const LocationCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	site_id: IdSchema,
	parent_id: NullableIdSchema,
	tenant_id: NullableIdSchema,
	description: DescriptionSchema,
})

export const LocationUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	// site_id is immutable after create: moving a subtree across sites
	// would silently re-parent every descendant.
	parent_id: v.optional(v.nullable(IdSchema), undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export type TenantGroupCreate = v.InferInput<typeof TenantGroupCreateSchema>
export type TenantGroupUpdate = v.InferInput<typeof TenantGroupUpdateSchema>
export type TenantCreate = v.InferInput<typeof TenantCreateSchema>
export type TenantUpdate = v.InferInput<typeof TenantUpdateSchema>
export type SiteCreate = v.InferInput<typeof SiteCreateSchema>
export type SiteUpdate = v.InferInput<typeof SiteUpdateSchema>
export type LocationCreate = v.InferInput<typeof LocationCreateSchema>
export type LocationUpdate = v.InferInput<typeof LocationUpdateSchema>

// Query-string contracts. Query values always arrive as strings, so page/limit
// coerce through Number instead of demanding JSON numbers like ListQuerySchema.
const CoercedPageSchema = v.optional(
	v.pipe(
		v.union([v.string(), v.number()]),
		v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw))),
		v.number(),
		v.integer(),
		v.minValue(1),
	),
	1,
)

const CoercedLimitSchema = v.optional(
	v.pipe(
		v.union([v.string(), v.number()]),
		v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw))),
		v.number(),
		v.integer(),
		v.minValue(1),
		v.maxValue(200),
	),
	50,
)

// biome-ignore lint/nursery/useExplicitType: entries are spread into v.object schemas — an annotation would erase the per-field inference the query types depend on
const ListQueryEntries = {
	search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
	page: CoercedPageSchema,
	limit: CoercedLimitSchema,
}

const OptionalIdEntry = v.optional(
	v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	undefined,
)

export const TenantGroupListQuerySchema = v.object({ ...ListQueryEntries })

export const TenantListQuerySchema = v.object({
	...ListQueryEntries,
	group_id: OptionalIdEntry,
})

export const SiteListQuerySchema = v.object({
	...ListQueryEntries,
	tenant: OptionalIdEntry,
})

export const LocationListQuerySchema = v.object({
	...ListQueryEntries,
	site: OptionalIdEntry,
	tenant: OptionalIdEntry,
	parent: OptionalIdEntry,
})

export const EntityParamsSchema = v.object({ id: IdSchema })

export type TenantGroupListQuery = v.InferInput<typeof TenantGroupListQuerySchema>
export type TenantListQuery = v.InferInput<typeof TenantListQuerySchema>
export type SiteListQuery = v.InferInput<typeof SiteListQuerySchema>
export type LocationListQuery = v.InferInput<typeof LocationListQuerySchema>

// ---------------------------------------------------------------------------
// P2: racks / shelves
// ---------------------------------------------------------------------------

/** Rack lifecycle label. Free-form on the wire is a typo magnet, so v1 is a closed set. */
export const RackStatusSchema = v.picklist(['active', 'planned', 'staged', 'decommissioned'])

export type RackStatus = v.InferInput<typeof RackStatusSchema>

/** Rack height in U: 1..60, default 42. */
export const RackHeightSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60))

/** Bottom-U position, 1-based. Upper bound is rack-dependent, checked in the service layer. */
export const PositionUSchema = v.pipe(v.number(), v.integer(), v.minValue(1))

/** U span of a shelf or device: at least 1 U. */
export const SpanHeightSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60))

export const RackCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	site_id: IdSchema,
	location_id: NullableIdSchema,
	tenant_id: NullableIdSchema,
	height_u: v.optional(RackHeightSchema, 42),
	status: v.optional(RackStatusSchema, 'active'),
})

export const RackUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	// site_id is immutable after create: shelves reference rack-local U
	// positions that are meaningless without the original rack height.
	location_id: v.optional(v.nullable(IdSchema), undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	height_u: v.optional(RackHeightSchema, undefined),
	status: v.optional(RackStatusSchema, undefined),
})

export const ShelfCreateSchema = v.strictObject({
	name: NameSchema,
	rack_id: IdSchema,
	position_u: PositionUSchema,
	height_u: v.optional(SpanHeightSchema, 1),
	capacity_slots: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
		undefined,
	),
})

export const ShelfUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	// rack_id is immutable after create: moving a shelf across racks would
	// silently reinterpret its U position against another rack's height.
	position_u: v.optional(PositionUSchema, undefined),
	height_u: v.optional(SpanHeightSchema, undefined),
	capacity_slots: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
		undefined,
	),
})

export type RackCreate = v.InferInput<typeof RackCreateSchema>
export type RackUpdate = v.InferInput<typeof RackUpdateSchema>
export type ShelfCreate = v.InferInput<typeof ShelfCreateSchema>
export type ShelfUpdate = v.InferInput<typeof ShelfUpdateSchema>

export const RackListQuerySchema = v.object({
	...ListQueryEntries,
	site: OptionalIdEntry,
	location: OptionalIdEntry,
	tenant: OptionalIdEntry,
})

export const ShelfListQuerySchema = v.object({
	...ListQueryEntries,
	rack: OptionalIdEntry,
})

export type RackListQuery = v.InferInput<typeof RackListQuerySchema>
export type ShelfListQuery = v.InferInput<typeof ShelfListQuerySchema>

// Elevation response (server-built, read by the client elevation view).
// `device` stays null until P4 fills device occupancy.
export interface ElevationShelfRef {
	id: string
	name: string
}

export interface ElevationUnit {
	u: number
	shelf: ElevationShelfRef | null
	device: ElevationShelfRef | null
}

export interface ElevationResponse {
	rack_id: string
	height_u: number
	/** Top-down: highest U first, so the client renders without re-sorting. */
	units: ElevationUnit[]
}
