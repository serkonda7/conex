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

export type Login = v.InferOutput<typeof LoginSchema>

// First-run admin provisioning. Same email/password contract as login;
// no minimum password length is enforced.
export const SetupSchema = v.strictObject({
	email: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(320)),
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

export const LocationCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
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
})

export const EntityParamsSchema = v.object({ id: IdSchema })

export type TenantListQuery = v.InferOutput<typeof TenantListQuerySchema>
export type SiteListQuery = v.InferOutput<typeof SiteListQuerySchema>
export type SiteGroupListQuery = v.InferOutput<typeof SiteGroupListQuerySchema>
export type LocationListQuery = v.InferOutput<typeof LocationListQuerySchema>

// ---------------------------------------------------------------------------
// P2: racks / shelves
// ---------------------------------------------------------------------------

/** Rack lifecycle label. Free-form on the wire is a typo magnet, so v1 is a closed set. */
export const RackStatusSchema = v.picklist(['active', 'planned', 'staged', 'decommissioned'])

export type RackStatus = v.InferOutput<typeof RackStatusSchema>

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
	description: DescriptionSchema,
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
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
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

export type RackCreate = v.InferOutput<typeof RackCreateSchema>
export type RackUpdate = v.InferOutput<typeof RackUpdateSchema>
export type ShelfCreate = v.InferOutput<typeof ShelfCreateSchema>
export type ShelfUpdate = v.InferOutput<typeof ShelfUpdateSchema>

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

export type RackListQuery = v.InferOutput<typeof RackListQuerySchema>
export type ShelfListQuery = v.InferOutput<typeof ShelfListQuerySchema>

// Elevation response (server-built, read by the client elevation view).
// `device` stays null until P4 fills device occupancy.
export interface ElevationShelfRef {
	id: number
	name: string
}

export interface ElevationUnit {
	u: number
	shelf: ElevationShelfRef | null
	device: ElevationShelfRef | null
}

export interface ElevationResponse {
	rack_id: number
	height_u: number
	/** Top-down: highest U first, so the client renders without re-sorting. */
	units: ElevationUnit[]
}

// ---------------------------------------------------------------------------
// P3: manufacturers / device templates
// ---------------------------------------------------------------------------

/** Interface kind label (e.g. `ethernet`, `fiber`, `power`, `console`). */
export const InterfaceKindSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(50))

/** Stub name prefix (e.g. `eth` expands to `eth0..ethN-1`). */
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
 * Rack units a device type consumes on mount: 0 = virtual or shelf-only
 * (P4 mounts those by shelf_id instead of position_u), otherwise 1..60.
 */
export const DeviceHeightSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(60))

export const StubLabelSchema = v.pipe(v.string(), v.trim(), v.maxLength(200))

export const ManufacturerCreateSchema = v.strictObject({
	name: NameSchema,
	slug: SlugSchema,
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
	slug: SlugSchema,
	u_height: v.optional(DeviceHeightSchema, 1),
	description: DescriptionSchema,
})

export const DeviceTypeUpdateSchema = v.strictObject({
	manufacturer_id: v.optional(IdSchema, undefined),
	model: v.optional(NameSchema, undefined),
	slug: v.optional(SlugSchema, undefined),
	u_height: v.optional(DeviceHeightSchema, undefined),
	description: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))), undefined),
})

export const StubCreateSchema = v.strictObject({
	prefix: InterfacePrefixSchema,
	count: v.optional(StubCountSchema, 1),
	kind: v.optional(InterfaceKindSchema, 'ethernet'),
	label: v.optional(v.nullable(StubLabelSchema), undefined),
})

export const StubUpdateSchema = v.strictObject({
	prefix: v.optional(InterfacePrefixSchema, undefined),
	count: v.optional(StubCountSchema, undefined),
	kind: v.optional(InterfaceKindSchema, undefined),
	label: v.optional(v.nullable(StubLabelSchema), undefined),
})

/** Ad-hoc preview body: expand one stub without storing it. */
export const StubPreviewBodySchema = v.strictObject({
	prefix: InterfacePrefixSchema,
	count: v.optional(StubCountSchema, 1),
	kind: v.optional(InterfaceKindSchema, 'ethernet'),
})

export type ManufacturerCreate = v.InferOutput<typeof ManufacturerCreateSchema>
export type ManufacturerUpdate = v.InferOutput<typeof ManufacturerUpdateSchema>
export type DeviceTypeCreate = v.InferOutput<typeof DeviceTypeCreateSchema>
export type DeviceTypeUpdate = v.InferOutput<typeof DeviceTypeUpdateSchema>
export type StubCreate = v.InferOutput<typeof StubCreateSchema>
export type StubUpdate = v.InferOutput<typeof StubUpdateSchema>
export type StubPreviewBody = v.InferOutput<typeof StubPreviewBodySchema>

export const ManufacturerListQuerySchema = v.object({ ...ListQueryEntries })

export const DeviceTypeListQuerySchema = v.object({
	...ListQueryEntries,
	manufacturer: OptionalIdEntry,
})

export type ManufacturerListQuery = v.InferOutput<typeof ManufacturerListQuerySchema>
export type DeviceTypeListQuery = v.InferOutput<typeof DeviceTypeListQuerySchema>

/** Ad-hoc preview query: `GET /device-types/preview?prefix=eth&count=24&kind=ethernet`. */
export const StubPreviewQuerySchema = v.object({
	prefix: InterfacePrefixSchema,
	count: v.optional(
		v.pipe(
			v.union([v.string(), v.number()]),
			v.transform((raw) => (typeof raw === 'number' ? raw : Number(raw))),
			v.number(),
			v.integer(),
			v.minValue(1),
			v.maxValue(1024),
		),
		1,
	),
	kind: v.optional(InterfaceKindSchema, 'ethernet'),
})

export type StubPreviewQuery = v.InferOutput<typeof StubPreviewQuerySchema>

/** One expanded interface name from a stub row. */
export interface ExpandedInterface {
	name: string
	kind: string
	label: string | null
}

/** Preview expansion response: stored stubs or one ad-hoc stub. */
export interface StubPreviewResponse {
	interfaces: ExpandedInterface[]
	total: number
}

// ---------------------------------------------------------------------------
// P4: devices / interfaces
// ---------------------------------------------------------------------------

/** Device lifecycle label. Same closed set as racks so filters stay uniform. */
export const DeviceStatusSchema = v.picklist(['active', 'planned', 'staged', 'decommissioned'])

export type DeviceStatus = v.InferOutput<typeof DeviceStatusSchema>

/** Interface name label (e.g. `eth0`). Same charset as stub prefixes. */
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
	// Mount is XOR (service-enforced): position_u XOR shelf_id, never both.
	// Unracked devices leave rack_id, position_u, and shelf_id all empty.
	position_u: v.optional(v.nullable(PositionUSchema), undefined),
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
		shelf_id: OptionalNullableIdEntry,
	}),
	v.check(
		(m) => m.rack_id !== undefined || m.position_u !== undefined || m.shelf_id !== undefined,
		'Provide at least one of rack_id, position_u, shelf_id',
	),
)

export const InterfaceCreateSchema = v.strictObject({
	name: InterfaceNameSchema,
	kind: v.optional(InterfaceKindSchema, 'ethernet'),
	description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), undefined),
})

export const InterfaceUpdateSchema = v.strictObject({
	// `connected` is owned by P5 cables, never edited directly.
	name: v.optional(InterfaceNameSchema, undefined),
	kind: v.optional(InterfaceKindSchema, undefined),
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
	sort: v.optional(v.picklist(['name', 'status']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const InterfaceListQuerySchema = v.object({ ...ListQueryEntries })

export type DeviceListQuery = v.InferOutput<typeof DeviceListQuerySchema>
export type InterfaceListQuery = v.InferOutput<typeof InterfaceListQuerySchema>

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

export interface DeviceTraceResponse {
	device_id: number
	links: TraceLink[]
}

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

/**
 * One device CSV row (minimal columns). Slugs resolve to ids server-side;
 * `position_u` arrives as text and coerces through Number.
 */
export const DeviceImportRowSchema = v.object({
	name: NameSchema,
	asset_tag: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), undefined),
	device_type_slug: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	site_slug: v.optional(
		v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
		undefined,
	),
	rack_slug: v.optional(
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

/** Per-row import outcome: created id or the row's error message. */
export interface ImportRowResult {
	row: number
	ok: boolean
	id: number | null
	error: string | null
}

export interface ImportResponse {
	created: number
	failed: number
	rows: ImportRowResult[]
}
