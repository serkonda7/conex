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

// Username identity for local auth. Stored lowercase (see
// `server/src/util/username.ts`); 1-64 chars of letters, digits, dot,
// dash, or underscore so it is URL-safe and unambiguous in logs.
export const UsernameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(64),
	v.regex(/^[A-Za-z0-9_.-]+$/, 'Must be letters, digits, dot, dash, or underscore'),
)

// Local-login credentials. strictObject so unknown keys fail loudly instead
// of being stripped; the route validator reports them through the shared
// onValidationError hook.
// `username` stays permissive (max 320, no charset check) so installs
// created before the email→username migration can still log in with their
// existing `admin@example.com`-style identity; new accounts are restricted
// by UsernameSchema in SetupSchema/UserCreateSchema.
export const LoginSchema = v.strictObject({
	username: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(320)),
	password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
})

export type Login = v.InferOutput<typeof LoginSchema>

// First-run admin provisioning. Same username/password contract as login;
// new usernames must satisfy UsernameSchema (no minimum password length).
export const SetupSchema = v.strictObject({
	username: UsernameSchema,
	password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
})

export type Setup = v.InferOutput<typeof SetupSchema>

// Shared list-query contract (?search=&page=&limit=) used by every P1+
// list endpoint. Defaults keep callers from re-declaring pagination math.
export const ListQuerySchema = v.strictObject({
	search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
	page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
	limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
})

export type ListQuery = v.InferOutput<typeof ListQuerySchema>

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

export const CommentsSchema = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), undefined)

/**
 * Entity id: a positive integer. Accepts a JSON number or the numeric string
 * forms that route params and query strings arrive as, and coerces to number
 * so the server always works with integer ids.
 */
export const IdSchema = v.pipe(
	v.union([v.string(), v.number()]),
	v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw.trim()))),
	v.number('Id must be an integer'),
	v.integer('Id must be an integer'),
	v.minValue(1, 'Id must be a positive integer'),
)

/** Nullable FK field: accepts a missing key, null, or an id. */
const NullableIdSchema = v.optional(v.nullable(IdSchema), undefined)

/** Maximum nesting depth of the location tree (root counts as depth 1). */
export const MAX_LOCATION_DEPTH = 5

/** Maximum nesting depth of the site-group tree (root counts as depth 1). */
export const MAX_SITE_GROUP_DEPTH = 5

export const TenantCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	description: DescriptionSchema,
	comments: CommentsSchema,
})

export const TenantUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

export const AddressSchema = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), undefined)

export const SiteCommentsSchema = v.optional(
	v.pipe(v.string(), v.trim(), v.maxLength(2000)),
	undefined,
)

export const SiteCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	tenant_id: NullableIdSchema,
	site_group_id: NullableIdSchema,
	description: DescriptionSchema,
	comments: SiteCommentsSchema,
	physical_address: AddressSchema,
	shipping_address: AddressSchema,
})

export const SiteUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	site_group_id: v.optional(v.nullable(IdSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
	physical_address: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
		undefined,
	),
	shipping_address: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
		undefined,
	),
})

/** Built-in location kinds; `other` covers anything not listed. */
export const LOCATION_TYPES = ['floor', 'room', 'other'] as const

export const LocationTypeSchema = v.picklist(LOCATION_TYPES)

export type LocationType = v.InferOutput<typeof LocationTypeSchema>

export const LocationCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	type: v.optional(LocationTypeSchema, 'other'),
	site_id: IdSchema,
	parent_id: NullableIdSchema,
	tenant_id: NullableIdSchema,
	description: DescriptionSchema,
})

export const SiteGroupCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
	tenant_id: NullableIdSchema,
	parent_id: NullableIdSchema,
	description: DescriptionSchema,
	comments: CommentsSchema,
})

export const SiteGroupUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	parent_id: v.optional(v.nullable(IdSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

export const LocationUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	type: v.optional(LocationTypeSchema, undefined),
	// site_id is immutable after create: moving a subtree across sites
	// would silently re-parent every descendant.
	parent_id: v.optional(v.nullable(IdSchema), undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export type TenantCreate = v.InferOutput<typeof TenantCreateSchema>
export type TenantUpdate = v.InferOutput<typeof TenantUpdateSchema>
export type SiteCreate = v.InferOutput<typeof SiteCreateSchema>
export type SiteUpdate = v.InferOutput<typeof SiteUpdateSchema>
export type LocationCreate = v.InferOutput<typeof LocationCreateSchema>
export type LocationUpdate = v.InferOutput<typeof LocationUpdateSchema>
export type SiteGroupCreate = v.InferOutput<typeof SiteGroupCreateSchema>
export type SiteGroupUpdate = v.InferOutput<typeof SiteGroupUpdateSchema>

// Query-string contracts. Query values always arrive as strings, so page/limit
// coerce through Number instead of demanding JSON numbers like ListQuerySchema.
// biome-ignore lint/nursery/useExplicitType: valibot schema inference must stay unannotated
// biome-ignore lint/nursery/useExplicitReturnType: valibot schema inference must stay unannotated
function coercedInt(min: number, max: number, fallback: number) {
	return v.optional(
		v.pipe(
			v.union([v.string(), v.number()]),
			v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw))),
			v.number(),
			v.integer(),
			v.minValue(min),
			v.maxValue(max),
		),
		fallback,
	)
}

const CoercedPageSchema = coercedInt(1, Number.MAX_SAFE_INTEGER, 1)

const CoercedLimitSchema = coercedInt(1, 200, 50)

// biome-ignore lint/nursery/useExplicitType: entries are spread into v.object schemas — an annotation would erase the per-field inference the query types depend on
const ListQueryEntries = {
	search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
	page: CoercedPageSchema,
	limit: CoercedLimitSchema,
}

const OptionalIdEntry = v.optional(IdSchema, undefined)

export const TenantListQuerySchema = v.object({
	...ListQueryEntries,
	sort: v.optional(v.picklist(['name', 'slug', 'description']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const SiteListQuerySchema = v.object({
	...ListQueryEntries,
	tenant: OptionalIdEntry,
	group: OptionalIdEntry,
	sort: v.optional(v.picklist(['name', 'slug', 'description']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const SiteGroupListQuerySchema = v.object({
	...ListQueryEntries,
	tenant: OptionalIdEntry,
	parent: OptionalIdEntry,
	sort: v.optional(v.picklist(['name', 'slug', 'description']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const LocationListQuerySchema = v.object({
	...ListQueryEntries,
	site: OptionalIdEntry,
	tenant: OptionalIdEntry,
	parent: OptionalIdEntry,
	sort: v.optional(v.picklist(['name', 'slug', 'description']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const EntityParamsSchema = v.object({ id: IdSchema })
export const DeviceIfaceParamsSchema = v.object({ id: IdSchema, ifaceId: IdSchema })
export const StubIdParamsSchema = v.object({ id: IdSchema, stubId: IdSchema })

export type TenantListQuery = v.InferOutput<typeof TenantListQuerySchema>
export type SiteListQuery = v.InferOutput<typeof SiteListQuerySchema>
export type SiteGroupListQuery = v.InferOutput<typeof SiteGroupListQuerySchema>
export type LocationListQuery = v.InferOutput<typeof LocationListQuerySchema>

// ---------------------------------------------------------------------------
// P2: racks
// ---------------------------------------------------------------------------

/** Bottom-U position, 1-based. Upper bound is rack-dependent, checked in the service layer. */
export const PositionUSchema = v.pipe(v.number(), v.integer(), v.minValue(1))

export const RackCreateSchema = v.strictObject({
	name: NameSchema,
	site_id: IdSchema,
	location_id: NullableIdSchema,
	tenant_id: NullableIdSchema,
	rack_type_id: IdSchema,
	description: DescriptionSchema,
})

export const RackUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	rack_type_id: v.optional(IdSchema, undefined),
	// site_id is immutable after create: rack placement depends on its site.
	location_id: v.optional(v.nullable(IdSchema), undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export type RackCreate = v.InferOutput<typeof RackCreateSchema>
export type RackUpdate = v.InferOutput<typeof RackUpdateSchema>

export const RackListQuerySchema = v.object({
	...ListQueryEntries,
	site: OptionalIdEntry,
	location: OptionalIdEntry,
	tenant: OptionalIdEntry,
	sort: v.optional(v.picklist(['name']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type RackListQuery = v.InferOutput<typeof RackListQuerySchema>

// Elevation response (server-built, read by the client elevation view).

/** Device sitting on a shelf (consumes no U of its own). */
export interface ElevationShelfDeviceRef {
	id: number
	name: string
	status: string
	device_type_model: string
}

export interface ElevationShelfRef {
	id: number
	name: string | null
	/** Rack face the shelf is mounted on, if set. */
	face: 'front' | 'rear' | null
	/** Bottom-U of the shelf (1-based). */
	position_u: number
	/** U height of the shelf mount hardware. */
	mount_height: number
	/** When true, the mount span stays usable for device mounts. */
	mount_usable: boolean
	/** Extra U reserved above the mount (always blocks device mounts). */
	reserved_height: number
	/** NetBox `is_full_depth`: true renders striped on the opposite face, false leaves it free. */
	is_full_depth: boolean
	/** Devices placed on this shelf, by name. */
	devices: ElevationShelfDeviceRef[]
}

export interface ElevationDeviceRef {
	id: number
	name: string
	/** Rack face the device is mounted on, if set. */
	face: 'front' | 'rear' | null
	/** Bottom-U of the device span (1-based). */
	position_u: number
	/** U height consumed on mount (from the device-type template). */
	u_height: number
	status: string
	device_type_id: number
	device_type_model: string
	/** NetBox `is_full_depth`: true renders striped on the opposite face, false leaves it free. */
	is_full_depth: boolean
}

export interface ElevationUnit {
	u: number
	device: ElevationDeviceRef | null
	/** All devices sharing this U, including opposite-face half-depth mounts. */
	devices?: ElevationDeviceRef[]
	/** Shelf blocking this U, if any. */
	shelf: ElevationShelfRef | null
	/** All shelves sharing this U (opposite-face half-depth mounts). */
	shelves?: ElevationShelfRef[]
}

export interface ElevationResponse {
	rack_id: number
	height_u: number
	/** Top-down: highest U first, so the client renders without re-sorting. */
	units: ElevationUnit[]
	/** U blocked by shelves (mount + reserved spans that are not mount-usable). */
	reserved_u: number
	/** All shelves mounted in this rack. */
	shelves: ElevationShelfRef[]
}

// ---------------------------------------------------------------------------
// P3: manufacturers / device templates
// ---------------------------------------------------------------------------

/** Interface kind label (e.g. `ethernet`, `fiber`, `power`, `console`). */
export const InterfaceKindSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(50))

/** Stub name prefix: count 1 keeps the name verbatim, count N>1 expands to `prefix1..prefixN` (e.g. `eth` x3 -> `eth1..eth3`). */
export const InterfacePrefixSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(50),
	v.regex(/^[A-Za-z0-9_.-]+$/, 'Must be letters, digits, dot, dash, or underscore'),
)

/** Port count of one stub row: at least 1. */
export const StubCountSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1024))

/**
 * Rack units a device type consumes on mount: 0-60 U. A zero-height device
 * cannot be mounted at a rack position. Shelves live in their own table.
 */
export const DeviceHeightSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(60))

/** NetBox rack form-factor choices. */
export const RackFormFactorSchema = v.picklist([
	'2-post frame',
	'4-post frame',
	'4-post cabinet',
	'wall-mounted frame',
	'wall-mounted cabinet',
])

export const RackWidthSchema = v.picklist([10, 19, 23])

export const StubLabelSchema = v.pipe(v.string(), v.trim(), v.maxLength(200))

export const ManufacturerCreateSchema = v.strictObject({
	name: NameSchema,
	slug: v.optional(SlugSchema, undefined),
	description: DescriptionSchema,
})

export const ManufacturerUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export const DeviceTypeCreateSchema = v.strictObject({
	manufacturer_id: IdSchema,
	model: NameSchema,
	u_height: v.optional(DeviceHeightSchema, 1),
	is_full_depth: v.optional(v.boolean(), true),
	form_factor: v.optional(RackFormFactorSchema, undefined),
	width: v.optional(RackWidthSchema, undefined),
	description: DescriptionSchema,
	comments: CommentsSchema,
})

export const DeviceTypeUpdateSchema = v.strictObject({
	manufacturer_id: v.optional(IdSchema, undefined),
	model: v.optional(NameSchema, undefined),
	u_height: v.optional(DeviceHeightSchema, undefined),
	is_full_depth: v.optional(v.boolean(), undefined),
	form_factor: v.optional(v.nullable(RackFormFactorSchema), undefined),
	width: v.optional(v.nullable(RackWidthSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

export const StubCreateSchema = v.strictObject({
	prefix: InterfacePrefixSchema,
	count: v.optional(StubCountSchema, 1),
	kind: v.optional(InterfaceKindSchema, 'ethernet'),
	label: v.optional(v.nullable(StubLabelSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export const StubUpdateSchema = v.strictObject({
	prefix: v.optional(InterfacePrefixSchema, undefined),
	count: v.optional(StubCountSchema, undefined),
	kind: v.optional(InterfaceKindSchema, undefined),
	label: v.optional(v.nullable(StubLabelSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export type ManufacturerCreate = v.InferOutput<typeof ManufacturerCreateSchema>
export type ManufacturerUpdate = v.InferOutput<typeof ManufacturerUpdateSchema>
export type DeviceTypeCreate = v.InferOutput<typeof DeviceTypeCreateSchema>
export type DeviceTypeUpdate = v.InferOutput<typeof DeviceTypeUpdateSchema>
export type StubCreate = v.InferOutput<typeof StubCreateSchema>
export type StubUpdate = v.InferOutput<typeof StubUpdateSchema>
export const ManufacturerListQuerySchema = v.object({
	...ListQueryEntries,
	sort: v.optional(v.picklist(['name', 'description']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const DeviceTypeListQuerySchema = v.object({
	...ListQueryEntries,
	manufacturer: OptionalIdEntry,
	kind: v.optional(v.picklist(['device', 'rack']), 'device'),
	sort: v.optional(v.picklist(['model', 'manufacturer', 'form_factor']), 'model'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type ManufacturerListQuery = v.InferOutput<typeof ManufacturerListQuerySchema>
export type DeviceTypeListQuery = v.InferOutput<typeof DeviceTypeListQuerySchema>

/** One expanded interface name from a stub row. */
export interface ExpandedInterface {
	name: string
	kind: string
	label: string | null
	description: string | null
}

// ---------------------------------------------------------------------------
// P4: devices / interfaces
// ---------------------------------------------------------------------------

/** Device lifecycle label. Same closed set as racks so filters stay uniform. */
export const DeviceStatusSchema = v.picklist(['active', 'planned', 'staged', 'decommissioned'])

export type DeviceStatus = v.InferOutput<typeof DeviceStatusSchema>

/** Interface name label (e.g. `eth1`). Same charset as stub prefixes. */
export const InterfaceNameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(100),
	v.regex(/^[A-Za-z0-9_.-]+$/, 'Must be letters, digits, dot, dash, or underscore'),
)

const OptionalNullableIdEntry = v.optional(v.nullable(IdSchema), undefined)

const OptionalNullablePositionEntry = v.optional(
	v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
	undefined,
)

/** Rack face a device is mounted on. Only meaningful for rack-mounted devices. */
export const DeviceFaceSchema = v.picklist(['front', 'rear'])

export type DeviceFace = v.InferOutput<typeof DeviceFaceSchema>

export const DeviceCreateSchema = v.strictObject({
	device_type_id: IdSchema,
	name: NameSchema,
	status: v.optional(DeviceStatusSchema, 'active'),
	site_id: NullableIdSchema,
	location_id: NullableIdSchema,
	rack_id: NullableIdSchema,
	face: v.optional(v.nullable(DeviceFaceSchema), undefined),
	// Unmounted devices leave position_u empty; rack_id may still be set
	// (rack-assigned but unracked) or empty (fully unracked).
	position_u: v.optional(v.nullable(PositionUSchema), undefined),
	// Place on a shelf instead of a U: rack follows the shelf, no position.
	shelf_id: NullableIdSchema,
	serial: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), undefined),
	asset_tag: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
	tenant_id: NullableIdSchema,
	description: DescriptionSchema,
})

export const DeviceUpdateSchema = v.strictObject({
	// device_type_id is immutable after create: swapping the template would
	// silently invalidate the expanded interface set and the U footprint.
	name: v.optional(NameSchema, undefined),
	status: v.optional(DeviceStatusSchema, undefined),
	site_id: v.optional(v.nullable(IdSchema), undefined),
	location_id: v.optional(v.nullable(IdSchema), undefined),
	rack_id: v.optional(v.nullable(IdSchema), undefined),
	face: v.optional(v.nullable(DeviceFaceSchema), undefined),
	position_u: v.optional(v.nullable(PositionUSchema), undefined),
	shelf_id: v.optional(v.nullable(IdSchema), undefined),
	serial: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
	asset_tag: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

/**
 * Explicit remount body: `undefined` keeps the current value, `null` clears
 * it. At least one key must be present so an empty body fails loudly.
 */
export const DeviceMoveSchema = v.pipe(
	v.strictObject({
		rack_id: OptionalNullableIdEntry,
		position_u: OptionalNullablePositionEntry,
	}),
	v.check(
		(m) => m.rack_id !== undefined || m.position_u !== undefined,
		'Provide at least one of rack_id or position_u',
	),
)

export const InterfaceCreateSchema = v.strictObject({
	name: InterfaceNameSchema,
	kind: v.optional(InterfaceKindSchema, 'ethernet'),
	enabled: v.optional(v.boolean(), undefined),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), undefined),
})

export const InterfaceUpdateSchema = v.strictObject({
	// `connected` is owned by P5 cables, never edited directly.
	name: v.optional(InterfaceNameSchema, undefined),
	kind: v.optional(InterfaceKindSchema, undefined),
	enabled: v.optional(v.boolean(), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export type DeviceCreate = v.InferOutput<typeof DeviceCreateSchema>
export type DeviceUpdate = v.InferOutput<typeof DeviceUpdateSchema>
export type DeviceMove = v.InferOutput<typeof DeviceMoveSchema>
export type InterfaceCreate = v.InferOutput<typeof InterfaceCreateSchema>
export type InterfaceUpdate = v.InferOutput<typeof InterfaceUpdateSchema>

export const DeviceListQuerySchema = v.object({
	...ListQueryEntries,
	site: OptionalIdEntry,
	rack: OptionalIdEntry,
	tenant: OptionalIdEntry,
	status: v.optional(DeviceStatusSchema, undefined),
	/** Placed = U-mounted; unplaced = neither mounted nor rack-assigned. */
	placed: v.optional(looseBoolean(false), undefined),
	sort: v.optional(v.picklist(['name', 'status']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

// biome-ignore lint/nursery/useExplicitType: valibot schema inference must stay unannotated
// biome-ignore lint/nursery/useExplicitReturnType: valibot schema inference must stay unannotated
function looseBoolean(emptyAsTrue: boolean) {
	return v.pipe(
		v.union([v.string(), v.number(), v.boolean()]),
		v.transform((raw): unknown => {
			if (typeof raw === 'boolean') {
				return raw
			}
			if (typeof raw === 'number') {
				return raw !== 0
			}
			const s = raw.trim().toLowerCase()
			if (
				s === 'true' ||
				s === '1' ||
				s === 'yes' ||
				s === 'y' ||
				(emptyAsTrue && s === '')
			) {
				return true
			}
			if (s === 'false' || s === '0' || s === 'no' || s === 'n') {
				return false
			}
			return raw
		}),
		v.boolean('Must be a boolean (true/false)'),
	)
}

export const InterfaceListQuerySchema = v.object({
	...ListQueryEntries,
	device: OptionalIdEntry,
	connected: v.optional(looseBoolean(false), undefined),
})

export type DeviceListQuery = v.InferOutput<typeof DeviceListQuerySchema>
export type InterfaceListQuery = v.InferOutput<typeof InterfaceListQuerySchema>

// ---------------------------------------------------------------------------
// Shelves (rack fixtures, fully separate from devices)
// ---------------------------------------------------------------------------

/** U height of the shelf mount hardware: at least 1 U. */
export const ShelfMountHeightSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60))

/** Extra U reserved above the mount: 0 = none. */
export const ShelfReservedHeightSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(0),
	v.maxValue(60),
)

export const ShelfCreateSchema = v.strictObject({
	name: v.optional(v.nullable(NameSchema), null),
	rack_id: IdSchema,
	face: v.optional(v.nullable(DeviceFaceSchema), undefined),
	position_u: PositionUSchema,
	mount_height: v.optional(ShelfMountHeightSchema, 1),
	/** When true, the mount span stays usable for device mounts. */
	mount_usable: v.optional(v.boolean(), false),
	reserved_height: v.optional(ShelfReservedHeightSchema, 0),
	/** NetBox `is_full_depth`: false allows opposite-face half-depth sharing. */
	is_full_depth: v.optional(v.boolean(), true),
	description: DescriptionSchema,
})

export const ShelfUpdateSchema = v.strictObject({
	name: v.optional(v.nullable(NameSchema), undefined),
	rack_id: v.optional(IdSchema, undefined),
	face: v.optional(v.nullable(DeviceFaceSchema), undefined),
	position_u: v.optional(PositionUSchema, undefined),
	mount_height: v.optional(ShelfMountHeightSchema, undefined),
	mount_usable: v.optional(v.boolean(), undefined),
	reserved_height: v.optional(ShelfReservedHeightSchema, undefined),
	is_full_depth: v.optional(v.boolean(), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export type ShelfCreate = v.InferOutput<typeof ShelfCreateSchema>
export type ShelfUpdate = v.InferOutput<typeof ShelfUpdateSchema>

export const ShelfListQuerySchema = v.object({
	...ListQueryEntries,
	rack: OptionalIdEntry,
	sort: v.optional(v.picklist(['name']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type ShelfListQuery = v.InferOutput<typeof ShelfListQuerySchema>

// ---------------------------------------------------------------------------
// P5: cables (L1)
// ---------------------------------------------------------------------------

/** Cable lifecycle label. `connected` is the normal live state. */
export const CableStatusSchema = v.picklist(['connected', 'planned', 'decommissioned'])

export type CableStatus = v.InferOutput<typeof CableStatusSchema>

/** Cable kind label (e.g. `cat6`, `fiber-om4`, `dac`). Free-form, like interface kinds. */
export const CableKindSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(50))

export const CableLabelSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))

export const CableCreateSchema = v.strictObject({
	a_interface_id: IdSchema,
	b_interface_id: IdSchema,
	status: v.optional(CableStatusSchema, 'connected'),
	kind: v.optional(CableKindSchema, undefined),
	label: v.optional(CableLabelSchema, undefined),
	description: DescriptionSchema,
})

export const CableUpdateSchema = v.strictObject({
	// Endpoints are immutable after create: re-cabling is delete + recreate
	// so both `connected` flags stay consistent.
	status: v.optional(CableStatusSchema, undefined),
	kind: v.optional(v.nullable(CableKindSchema), undefined),
	label: v.optional(v.nullable(CableLabelSchema), undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

/** Convenience connect body: `POST` one end in the path, the peer in the body. */
export const InterfaceConnectSchema = v.strictObject({
	peer_interface_id: IdSchema,
})

export type CableCreate = v.InferOutput<typeof CableCreateSchema>
export type CableUpdate = v.InferOutput<typeof CableUpdateSchema>
export type InterfaceConnect = v.InferOutput<typeof InterfaceConnectSchema>

export const CableListQuerySchema = v.object({
	...ListQueryEntries,
	status: v.optional(CableStatusSchema, undefined),
	/** Filter to cables touching this interface (either end). */
	interface: OptionalIdEntry,
	/** Filter to cables touching any interface of this device (either end). */
	device: OptionalIdEntry,
})

export type CableListQuery = v.InferOutput<typeof CableListQuerySchema>

/** One peer link in a per-device trace. */
export interface TracePeerInterface {
	id: number
	name: string
	kind: string
}

export interface TracePeerDevice {
	id: number
	name: string
}

export interface TraceLink {
	cable_id: number
	cable_label: string | null
	cable_status: string
	local_interface: TracePeerInterface
	peer_device: TracePeerDevice
	peer_interface: TracePeerInterface
}

/** One cable hop in a multi-hop trace path (`from` -> `to`). */
export interface TraceHop {
	cable_id: number
	cable_label: string | null
	cable_status: string
	from_device: TracePeerDevice
	from_interface: TracePeerInterface
	to_device: TracePeerDevice
	to_interface: TracePeerInterface
}

/** One shortest path from a trace source to a reachable device. */
export interface TracePath {
	hops: TraceHop[]
	end_device: TracePeerDevice
}

export interface DeviceTraceResponse {
	device_id: number
	links: TraceLink[]
	/** Shortest-path multi-hop traces (depth-limited, see TraceQuerySchema). */
	paths: TracePath[]
}

/** Per-interface trace: all shortest paths starting at one port. */
export interface InterfaceTraceResponse {
	start_device: TracePeerDevice
	start_interface: TracePeerInterface
	paths: TracePath[]
}

/** Per-cable trace: endpoints plus onward paths from each side. */
export interface CableTraceResponse {
	cable_id: number
	cable_label: string | null
	cable_status: string
	a_device: TracePeerDevice
	a_interface: TracePeerInterface
	b_device: TracePeerDevice
	b_interface: TracePeerInterface
	paths_from_a: TracePath[]
	paths_from_b: TracePath[]
}

/**
 * Trace depth query (`?depth=`): how many cable hops a multi-hop trace may
 * follow. Capped at 10 so a dense mesh cannot explode the response.
 */
export const TraceQuerySchema = v.object({
	depth: coercedInt(1, 10, 4),
})

export type TraceQuery = v.InferOutput<typeof TraceQuerySchema>

// ---------------------------------------------------------------------------
// Topology view (device graph)
// ---------------------------------------------------------------------------

/** One device node in the topology graph. */
export interface TopologyNode {
	id: number
	name: string
	status: string
	site_id: number | null
	rack_id: number | null
	tenant_id: number | null
}

export interface TopologyEndpoint {
	device: TracePeerDevice
	iface: TracePeerInterface
}

/** One cable edge in the topology graph (device-to-device). */
export interface TopologyEdge {
	cable_id: number
	cable_label: string | null
	cable_status: string
	cable_kind: string | null
	a: TopologyEndpoint
	b: TopologyEndpoint
}

export interface TopologyResponse {
	nodes: TopologyNode[]
	edges: TopologyEdge[]
}

export const TopologyQuerySchema = v.object({
	site: OptionalIdEntry,
	device: OptionalIdEntry,
	tenant: OptionalIdEntry,
	group: OptionalIdEntry,
})

export type TopologyQuery = v.InferOutput<typeof TopologyQuerySchema>

// ---------------------------------------------------------------------------
// P7: users / roles
// ---------------------------------------------------------------------------

/**
 * User role: `admin` manages users/roles and reads+writes everything;
 * `editor` reads+writes inventory (no user management); `viewer` reads only.
 * Editors and viewers with a `tenant_id` set are strictly limited to that
 * single tenant (null-tenant rows are invisible to them); `tenant_id = NULL`
 * means global (all tenants). Admins ignore tenant scope entirely.
 */
export const RoleSchema = v.picklist(['admin', 'editor', 'viewer'])

export type Role = v.InferOutput<typeof RoleSchema>

export const UserCreateSchema = v.strictObject({
	username: UsernameSchema,
	password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
	role: v.optional(RoleSchema, 'viewer'),
	tenant_id: NullableIdSchema,
})

export const UserUpdateSchema = v.strictObject({
	role: v.optional(RoleSchema, undefined),
	tenant_id: v.optional(v.nullable(IdSchema), undefined),
	password: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(1024)), undefined),
})

export const UserListQuerySchema = v.object({
	...ListQueryEntries,
	role: v.optional(RoleSchema, undefined),
	tenant: OptionalIdEntry,
})

/** Public user shape: password hashes never leave the server. */
export interface UserJson {
	id: number
	username: string
	role: Role
	tenant_id: number | null
}

export type UserCreate = v.InferOutput<typeof UserCreateSchema>
export type UserUpdate = v.InferOutput<typeof UserUpdateSchema>
export type UserListQuery = v.InferOutput<typeof UserListQuerySchema>

// ---------------------------------------------------------------------------
// P6: global search / CSV import
// ---------------------------------------------------------------------------

/** Global search query: `GET /search?q=`. Empty query returns empty groups. */
export const SearchQuerySchema = v.object({
	q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
})

export type SearchQuery = v.InferOutput<typeof SearchQuerySchema>

/** JSON body for CSV imports: raw CSV text, parsed row-by-row server-side. */
export const CsvImportBodySchema = v.strictObject({
	csv: v.pipe(v.string(), v.minLength(1), v.maxLength(1_000_000)),
})

export type CsvImportBody = v.InferOutput<typeof CsvImportBodySchema>

/** JSON body for NetBox device-type YAML imports. */
export const YamlImportBodySchema = v.strictObject({
	yaml: v.pipe(v.string(), v.minLength(1), v.maxLength(1_000_000)),
})

export type YamlImportBody = v.InferOutput<typeof YamlImportBodySchema>

/**
 * One device CSV row (minimal columns). Device type models and rack names resolve to ids server-side;
 * `position_u` arrives as text and coerces through Number.
 */
export const DeviceImportRowSchema = v.object({
	name: NameSchema,
	asset_tag: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), undefined),
	device_type_model: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	site_slug: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
		undefined,
	),
	rack_name: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
		undefined,
	),
	position_u: v.optional(
		v.pipe(
			v.union([v.string(), v.number()]),
			v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw))),
			v.number(),
			v.integer(),
			v.minValue(1),
		),
		undefined,
	),
	status: v.optional(DeviceStatusSchema, 'active'),
})

export type DeviceImportRow = v.InferOutput<typeof DeviceImportRowSchema>

/** One cable CSV row: device/interface names resolve to ids server-side. */
export const CableImportRowSchema = v.object({
	a_device: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	a_interface: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	b_device: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	b_interface: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	label: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), undefined),
	kind: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50)), undefined),
	status: v.optional(CableStatusSchema, 'connected'),
})

export type CableImportRow = v.InferOutput<typeof CableImportRowSchema>

/**
 * Loose boolean for CSV cells: true/false, 1/0, yes/no (case-insensitive),
 * with an empty cell defaulting to true (full depth). Unknown text falls
 * through so the trailing `v.boolean()` fails validation loudly.
 */
const LooseBooleanSchema = looseBoolean(true)

/**
 * One device-type CSV row. `manufacturer_slug` resolves to an id
 * server-side; `u_height`/`width` arrive as text and coerce through Number.
 */
export const DeviceTypeImportRowSchema = v.object({
	manufacturer_slug: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	model: NameSchema,
	u_height: v.optional(
		v.pipe(
			v.union([v.string(), v.number()]),
			v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw))),
			v.number(),
			v.integer(),
			v.minValue(0),
			v.maxValue(60),
		),
		1,
	),
	is_full_depth: v.optional(LooseBooleanSchema, true),
	form_factor: v.optional(RackFormFactorSchema, undefined),
	width: v.optional(
		v.pipe(
			v.union([v.string(), v.number()]),
			v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw))),
			v.number(),
			v.integer(),
			v.check((n) => n === 10 || n === 19 || n === 23, 'Must be one of 10, 19, 23'),
		),
		undefined,
	),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), undefined),
	comments: CommentsSchema,
})

export type DeviceTypeImportRow = v.InferOutput<typeof DeviceTypeImportRowSchema>

/** Per-row import outcome: created id or the row's error message. */
export interface ImportRowResult {
	row: number
	ok: boolean
	id: number | null
	error: string | null
	/** Set when the row failed only because this manufacturer does not exist. */
	unknown_manufacturer?: string
}

export interface ImportResponse {
	created: number
	failed: number
	rows: ImportRowResult[]
}
