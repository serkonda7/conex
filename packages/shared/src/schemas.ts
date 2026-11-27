/**
 * Runtime contracts for everything a client may send to the API.
 *
 * The TypeScript types are derived from these schemas instead of being written
 * by hand, so the runtime check and the compile-time type cannot drift apart.
 *
 * P0 placeholder: only auth + shared list contracts exist. Domain schemas
 * (tenants, sites, racks, devices, cables) are added in P1-P5.
 */
import {
	CalendarDateSchema,
	DeviceHeightSchema,
	DeviceTypeDescriptionSchema,
	InterfaceKindSchema,
	looseBoolean,
	NameSchema,
	PanelFaceSchema,
	type PoeType,
	PortPositionsSchema,
	type PortSide,
	PortSideSchema,
	StubFieldEntries as PortStubFieldEntries,
	StubCountSchema,
	StubDigitsSchema,
	StubPowerEntries,
	StubStartSchema,
	trimStubPrefix,
	WebsiteSchema,
} from '@serkonda7/conex-device-schema'
import * as v from 'valibot'

export * from '@serkonda7/conex-device-schema'

// Username identity for local auth. Stored lowercase (see
// `normalizeLogin` in `shared/src/login.ts`); 1-254 chars of letters, digits, dot,
// dash, underscore, plus or `@` (accounts of employees sign in with their
// primary mail address), unambiguous in logs.
export const UsernameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(254),
	v.regex(/^[A-Za-z0-9_.+@-]+$/, 'Must be letters, digits, dot, dash, underscore, plus, or @'),
)

// Local-login credentials. strictObject so unknown keys fail loudly instead
// of being stripped; the route validator reports them through the shared
// onValidationError hook.
export const LoginSchema = v.strictObject({
	username: UsernameSchema,
	password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
})

export type Login = v.InferOutput<typeof LoginSchema>

// First-run admin provisioning. Same username/password contract as login
// (no minimum password length).
export const SetupSchema = v.strictObject({
	username: UsernameSchema,
	password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
})

export type Setup = v.InferOutput<typeof SetupSchema>

// Self-service password change: the current password re-authenticates the
// session owner before the new one is stored.
export const PasswordChangeSchema = v.strictObject({
	current_password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
	new_password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
})

export type PasswordChange = v.InferOutput<typeof PasswordChangeSchema>

// Shared list-query contract (?search=&page=&limit=) used by every P1+
// list endpoint. Defaults keep callers from re-declaring pagination math.

/** Page-size options offered by list tables and the maximum allowed `limit`. */
export const PAGE_SIZES = [25, 50, 100, 200]
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

export const ListQuerySchema = v.strictObject({
	search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
	page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
	limit: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_PAGE_SIZE)),
		DEFAULT_PAGE_SIZE,
	),
})

export type ListQuery = v.InferOutput<typeof ListQuerySchema>

// ---------------------------------------------------------------------------
// P1: tenants / sites / locations
// ---------------------------------------------------------------------------

export const DescriptionSchema = v.optional(
	v.pipe(v.string(), v.trim(), v.maxLength(500)),
	undefined,
)

/** Nullable description: accepts a missing key, null, or up to 500 characters. */
const NullableDescriptionSchema = v.optional(
	v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(500))),
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

/** Optional short contact field (title, email, phone numbers). */
const ContactFieldSchema = v.pipe(v.string(), v.trim(), v.maxLength(200))

const EmailSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(200),
	v.email('Must be an email address'),
)

/** Salutation of an employee (`mr` = Herr, `ms` = Frau). */
export const EMPLOYEE_SALUTATIONS = ['mr', 'ms'] as const

export const EmployeeSalutationSchema = v.picklist(EMPLOYEE_SALUTATIONS)

export type EmployeeSalutation = v.InferOutput<typeof EmployeeSalutationSchema>

/** Whether an employee's mail address or phone number is for work or private use. */
export const CONTACT_SCOPES = ['work', 'private'] as const

export const ContactScopeSchema = v.picklist(CONTACT_SCOPES)

export type ContactScope = v.InferOutput<typeof ContactScopeSchema>

/** Kind of an employee phone number; `extension` is a direct-dial extension (Durchwahl). */
export const PHONE_TYPES = ['phone', 'mobile', 'extension'] as const

export const PhoneTypeSchema = v.picklist(PHONE_TYPES)

export type PhoneType = v.InferOutput<typeof PhoneTypeSchema>

/** One mail address of an employee; the first one in the list is the primary address. */
export const EmployeeEmailSchema = v.strictObject({
	address: EmailSchema,
	scope: ContactScopeSchema,
})

export const EmployeePhoneSchema = v.strictObject({
	number: v.pipe(ContactFieldSchema, v.minLength(1)),
	type: PhoneTypeSchema,
	scope: ContactScopeSchema,
})

/**
 * Company-wide mail address / phone number of a tenant (main contact). No
 * work/private scope; the first mail address is the primary one, and its
 * domain is the company mail domain.
 */
export const TenantEmailSchema = v.strictObject({ address: EmailSchema })

export const TenantPhoneSchema = v.strictObject({
	number: v.pipe(ContactFieldSchema, v.minLength(1)),
	type: PhoneTypeSchema,
})

export type EmployeeEmail = v.InferOutput<typeof EmployeeEmailSchema>
export type EmployeePhone = v.InferOutput<typeof EmployeePhoneSchema>
export type TenantEmail = v.InferOutput<typeof TenantEmailSchema>
export type TenantPhone = v.InferOutput<typeof TenantPhoneSchema>

const EmployeeEmailsSchema = v.pipe(v.array(EmployeeEmailSchema), v.maxLength(20))
const EmployeePhonesSchema = v.pipe(v.array(EmployeePhoneSchema), v.maxLength(20))
const TenantEmailsSchema = v.pipe(v.array(TenantEmailSchema), v.maxLength(20))
const TenantPhonesSchema = v.pipe(v.array(TenantPhoneSchema), v.maxLength(20))

/** Primary mail address: the first one in the list. */
export function primaryEmail(emails: readonly TenantEmail[]): string | null {
	return emails[0]?.address ?? null
}

/** First phone number of `type`, the primary one of that kind. */
export function primaryPhone(phones: readonly TenantPhone[], type: PhoneType): string | null {
	return phones.find((p) => p.type === type)?.number ?? null
}

/** Company mail domain of a tenant: the domain of its primary mail address. */
export function emailDomain(emails: readonly TenantEmail[]): string | null {
	const address = primaryEmail(emails)
	const at = address?.lastIndexOf('@') ?? -1
	return address && at >= 0 ? address.slice(at + 1) : null
}

/**
 * Completes an address typed without a domain (`max.mustermann` or
 * `max.mustermann@`) with `domain`; other input is returned unchanged.
 */
export function withEmailDomain(address: string, domain: string | null): string {
	const trimmed = address.trim()
	const at = trimmed.indexOf('@')
	const local = at >= 0 ? trimmed.slice(0, at) : trimmed
	if (domain === null || local === '' || (at >= 0 && at < trimmed.length - 1)) {
		return address
	}
	return `${local}@${domain}`
}

/** Tenant groups are flat: a named bundle of tenants, no parent. */
export const TenantGroupCreateSchema = v.strictObject({
	name: NameSchema,
	description: DescriptionSchema,
	comments: CommentsSchema,
})

export const TenantGroupUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	description: NullableDescriptionSchema,
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

/** Optional customer number / device ID: free text, unique when set. */
export const CustomerNumberSchema = v.optional(
	v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))),
	undefined,
)

export const DeviceIdSchema = v.optional(
	v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))),
	undefined,
)

/** Link target of a website: bare hosts get `https://`. */
export function websiteUrl(website: string): string {
	return /^https?:\/\//i.test(website) ? website : `https://${website}`
}

/** A contracted managed bundle and the SLA it comes with. */
export const TenantBundleSchema = v.strictObject({
	managed_bundle_id: IdSchema,
	service_level_id: IdSchema,
})

export type TenantBundle = v.InferOutput<typeof TenantBundleSchema>

/** Contracted bundles of a tenant: at most one SLA per bundle. */
const TenantBundlesSchema = v.pipe(
	v.array(TenantBundleSchema),
	v.check(
		(bundles) => new Set(bundles.map((b) => b.managed_bundle_id)).size === bundles.length,
		'Each bundle may be contracted only once',
	),
)

/** A stored bundle contract with its names, as returned by the API. */
export interface TenantBundleJson {
	managed_bundle_id: number
	managed_bundle_name: string
	service_level_id: number
	service_level_name: string
}

export const TenantCreateSchema = v.strictObject({
	name: NameSchema,
	tenant_group_id: NullableIdSchema,
	customer_number: CustomerNumberSchema,
	website: v.optional(WebsiteSchema, undefined),
	emails: v.optional(TenantEmailsSchema, []),
	phones: v.optional(TenantPhonesSchema, []),
	bundles: v.optional(TenantBundlesSchema, []),
	comments: CommentsSchema,
})

export const TenantUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	tenant_group_id: NullableIdSchema,
	customer_number: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))),
		undefined,
	),
	website: v.optional(v.nullable(WebsiteSchema), undefined),
	emails: v.optional(TenantEmailsSchema, undefined),
	phones: v.optional(TenantPhonesSchema, undefined),
	/** Replaces the stored contracts when present. */
	bundles: v.optional(TenantBundlesSchema, undefined),
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

const StreetSchema = v.pipe(v.string(), v.trim(), v.maxLength(200))
const PostcodeSchema = v.pipe(v.string(), v.trim(), v.maxLength(20))
const CitySchema = v.pipe(v.string(), v.trim(), v.maxLength(100))

export const SiteCommentsSchema = v.optional(
	v.pipe(v.string(), v.trim(), v.maxLength(2000)),
	undefined,
)

export const SiteCreateSchema = v.strictObject({
	name: NameSchema,
	tenant_id: NullableIdSchema,
	site_group_id: NullableIdSchema,
	description: DescriptionSchema,
	comments: SiteCommentsSchema,
	physical_street: v.optional(StreetSchema, undefined),
	physical_postcode: v.optional(PostcodeSchema, undefined),
	physical_city: v.optional(CitySchema, undefined),
	shipping_street: v.optional(StreetSchema, undefined),
	shipping_postcode: v.optional(PostcodeSchema, undefined),
	shipping_city: v.optional(CitySchema, undefined),
})

export const SiteUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	tenant_id: NullableIdSchema,
	site_group_id: NullableIdSchema,
	description: NullableDescriptionSchema,
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
	physical_street: v.optional(v.nullable(StreetSchema), undefined),
	physical_postcode: v.optional(v.nullable(PostcodeSchema), undefined),
	physical_city: v.optional(v.nullable(CitySchema), undefined),
	shipping_street: v.optional(v.nullable(StreetSchema), undefined),
	shipping_postcode: v.optional(v.nullable(PostcodeSchema), undefined),
	shipping_city: v.optional(v.nullable(CitySchema), undefined),
})

/** Built-in location kinds; `other` covers anything not listed. */
export const LOCATION_TYPES = ['building', 'floor', 'room', 'desk', 'other'] as const

export const LocationTypeSchema = v.picklist(LOCATION_TYPES)

export type LocationType = v.InferOutput<typeof LocationTypeSchema>

export const LocationCreateSchema = v.strictObject({
	name: NameSchema,
	type: v.optional(LocationTypeSchema, 'other'),
	site_id: IdSchema,
	parent_id: NullableIdSchema,
	tenant_id: NullableIdSchema,
	description: DescriptionSchema,
})

export const SiteGroupCreateSchema = v.strictObject({
	name: NameSchema,
	tenant_id: NullableIdSchema,
	description: DescriptionSchema,
	comments: CommentsSchema,
})

export const SiteGroupUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	tenant_id: NullableIdSchema,
	description: NullableDescriptionSchema,
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

export const LocationUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	type: v.optional(LocationTypeSchema, undefined),
	// site_id is immutable after create: moving a subtree across sites
	// would silently re-parent every descendant.
	parent_id: NullableIdSchema,
	tenant_id: NullableIdSchema,
	description: NullableDescriptionSchema,
})

/**
 * Tenants of an employee, in order: the first is the primary tenant (mail
 * domain, main number for extensions).
 */
const EmployeeTenantIdsSchema = v.pipe(
	v.array(IdSchema),
	v.minLength(1, 'An employee needs at least one tenant'),
	v.maxLength(50),
	v.check((ids) => new Set(ids).size === ids.length, 'Tenants must be unique'),
)

/** Employees always belong to at least one tenant (contact persons of customers). */
export const EmployeeCreateSchema = v.strictObject({
	first_name: v.optional(NameSchema, undefined),
	last_name: NameSchema,
	salutation: v.optional(v.nullable(EmployeeSalutationSchema), undefined),
	tenant_ids: EmployeeTenantIdsSchema,
	title: v.optional(ContactFieldSchema, undefined),
	emails: v.optional(EmployeeEmailsSchema, []),
	phones: v.optional(EmployeePhonesSchema, []),
	active: v.optional(v.boolean(), true),
	description: DescriptionSchema,
	comments: CommentsSchema,
})

export const EmployeeUpdateSchema = v.strictObject({
	first_name: v.optional(v.nullable(NameSchema), undefined),
	last_name: v.optional(NameSchema, undefined),
	salutation: v.optional(v.nullable(EmployeeSalutationSchema), undefined),
	tenant_ids: v.optional(EmployeeTenantIdsSchema, undefined),
	title: v.optional(v.nullable(ContactFieldSchema), undefined),
	emails: v.optional(EmployeeEmailsSchema, undefined),
	phones: v.optional(EmployeePhonesSchema, undefined),
	active: v.optional(v.boolean(), undefined),
	description: NullableDescriptionSchema,
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

/**
 * Active employee as published by `/directory/contacts` for telephony. Phone
 * numbers are normalized (`normalizePhone`) and spread over fixed slots;
 * further numbers are left out.
 */
export interface DirectoryContact {
	id: number
	customer_number: string | null
	company: string
	first_name: string | null
	last_name: string
	name: string
	title: string | null
	email: string | null
	phone_business: string | null
	phone_business2: string | null
	phone_home: string | null
	phone_home2: string | null
	phone_mobile: string | null
	phone_mobile2: string | null
	phone_mobile_home: string | null
	phone_mobile_home2: string | null
}

export type EmployeeCreate = v.InferOutput<typeof EmployeeCreateSchema>
export type EmployeeUpdate = v.InferOutput<typeof EmployeeUpdateSchema>
export type TenantGroupCreate = v.InferOutput<typeof TenantGroupCreateSchema>
export type TenantGroupUpdate = v.InferOutput<typeof TenantGroupUpdateSchema>
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

/**
 * Multi-select filter value: one or several items as a scalar, a
 * comma-separated string (`1,2`) or a repeated query key.
 */
const CsvListSchema = v.pipe(
	v.union([v.string(), v.number(), v.array(v.union([v.string(), v.number()]))]),
	v.transform((raw): (string | number)[] =>
		(Array.isArray(raw) ? raw : [raw])
			.flatMap((item): (string | number)[] =>
				typeof item === 'string' ? item.split(',') : [item],
			)
			.map((item) => (typeof item === 'string' ? item.trim() : item))
			.filter((item) => item !== ''),
	),
)

const emptyAsUndefined = <T>(list: T[]): T[] | undefined => (list.length > 0 ? list : undefined)

const OptionalIdListEntry = v.optional(
	v.pipe(CsvListSchema, v.array(IdSchema), v.transform(emptyAsUndefined)),
	undefined,
)

export const TenantGroupListQuerySchema = v.object({
	...ListQueryEntries,
	sort: v.optional(v.picklist(['name', 'description', 'tenants']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const TenantListQuerySchema = v.object({
	...ListQueryEntries,
	/** Only tenants of these tenant groups. */
	group: OptionalIdListEntry,
	sort: v.optional(
		v.picklist(['name', 'customer_number', 'group', 'sites', 'racks', 'devices']),
		'name',
	),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const SiteListQuerySchema = v.object({
	...ListQueryEntries,
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
	/** Only sites of these site groups. */
	group: OptionalIdListEntry,
	sort: v.optional(v.picklist(['name', 'description', 'tenant', 'group']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const SiteGroupListQuerySchema = v.object({
	...ListQueryEntries,
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
	sort: v.optional(v.picklist(['name', 'description', 'tenant']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const LocationListQuerySchema = v.object({
	...ListQueryEntries,
	site: OptionalIdListEntry,
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
	parent: OptionalIdEntry,
	type: v.optional(
		v.pipe(CsvListSchema, v.array(LocationTypeSchema), v.transform(emptyAsUndefined)),
		undefined,
	),
	sort: v.optional(v.picklist(['name', 'description', 'type', 'site', 'tenant']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const EmployeeListQuerySchema = v.object({
	...ListQueryEntries,
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
	/** `true` / `false` narrows to active / inactive employees. */
	active: v.optional(v.picklist(['true', 'false']), undefined),
	sort: v.optional(
		v.picklist([
			'name',
			'first_name',
			'last_name',
			'salutation',
			'title',
			'email',
			'status',
			'description',
		]),
		'last_name',
	),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type EmployeeListQuery = v.InferOutput<typeof EmployeeListQuerySchema>

export const EntityParamsSchema = v.object({ id: IdSchema })
export const DeviceIfaceParamsSchema = v.object({ id: IdSchema, ifaceId: IdSchema })
export const StubIdParamsSchema = v.object({ id: IdSchema, stubId: IdSchema })

export type TenantGroupListQuery = v.InferOutput<typeof TenantGroupListQuerySchema>
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
	location_id: NullableIdSchema,
	tenant_id: NullableIdSchema,
	description: NullableDescriptionSchema,
})

export type RackCreate = v.InferOutput<typeof RackCreateSchema>
export type RackUpdate = v.InferOutput<typeof RackUpdateSchema>

export const RackListQuerySchema = v.object({
	...ListQueryEntries,
	site: OptionalIdListEntry,
	location: OptionalIdListEntry,
	rack_type: OptionalIdListEntry,
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
	sort: v.optional(
		v.picklist(['name', 'site', 'location', 'description', 'type', 'height', 'tenant']),
		'name',
	),
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
	/** U height of the shelf mount hardware (0 for a dummy shelf). */
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

/** A port of a device in the elevation's device images. */
export interface FaceplatePortJson {
	id: number
	name: string
	kind: string
	side: PortSide | null
	/** Resolved panel face: the stub's, else inferred (`portFace`). */
	face: 'front' | 'rear'
	connected: boolean
	enabled: boolean
}

/** `GET /racks/:id/faceplates`: the ports of each U-mounted device with ports. */
export interface RackFaceplatesResponse {
	devices: { device_id: number; ports: FaceplatePortJson[] }[]
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

/** Characters of a port name: ASCII letters, German umlauts and ß, digits, `_.-?` and spaces. */
const PORT_NAME_PATTERN = /^[A-Za-z0-9ÄÖÜäöüß_.?\- ]+$/
const PORT_NAME_MESSAGE = 'Must be letters, digits, space, dot, dash, underscore, or question mark'

/**
 * Stub name prefix: count 1 keeps the name verbatim, count N>1 expands to
 * `prefix1..prefixN` (e.g. `eth` x3 -> `eth1..eth3`, `Port ` x8 with 2
 * digits from 17 -> `Port 17..Port 24`). One trailing space stays as the separator.
 * Empty for a run of bare numbers (`01..24`); a single port needs a name,
 * which the stub expansion checks.
 */
export const InterfacePrefixSchema = v.pipe(
	v.string(),
	v.transform(trimStubPrefix),
	v.maxLength(50),
	v.check((prefix) => prefix === '' || PORT_NAME_PATTERN.test(prefix), PORT_NAME_MESSAGE),
)

/** NetBox rack form-factor choices. */
export const RACK_FORM_FACTORS = [
	'2-post frame',
	'4-post frame',
	'4-post cabinet',
	'wall-mounted frame',
	'wall-mounted cabinet',
] as const

export const RackFormFactorSchema = v.picklist(RACK_FORM_FACTORS)

/** Maximum rack height in U. */
export const MAX_RACK_HEIGHT_U = 60

/** Rack units a rack type provides: 1-{@link MAX_RACK_HEIGHT_U} U. */
export const RackHeightSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(1),
	v.maxValue(MAX_RACK_HEIGHT_U),
)

export const ManufacturerCreateSchema = v.strictObject({
	name: NameSchema,
	description: DescriptionSchema,
	website: v.optional(WebsiteSchema, undefined),
	support_url: v.optional(WebsiteSchema, undefined),
	comments: CommentsSchema,
})

export const ManufacturerUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	description: NullableDescriptionSchema,
	website: v.optional(v.nullable(WebsiteSchema), undefined),
	support_url: v.optional(v.nullable(WebsiteSchema), undefined),
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

export const DeviceTypeCreateSchema = v.strictObject({
	manufacturer_id: IdSchema,
	model: NameSchema,
	u_height: v.optional(DeviceHeightSchema, 1),
	is_full_depth: v.optional(v.boolean(), true),
	part_number: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), undefined),
	spec_url: v.optional(WebsiteSchema, undefined),
	eol_date: v.optional(CalendarDateSchema, undefined),
	description: v.optional(DeviceTypeDescriptionSchema, undefined),
	comments: CommentsSchema,
	default_device_role_id: NullableIdSchema,
})

export const DeviceTypeUpdateSchema = v.strictObject({
	manufacturer_id: v.optional(IdSchema, undefined),
	model: v.optional(NameSchema, undefined),
	u_height: v.optional(DeviceHeightSchema, undefined),
	is_full_depth: v.optional(v.boolean(), undefined),
	part_number: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
	spec_url: v.optional(v.nullable(WebsiteSchema), undefined),
	eol_date: v.optional(v.nullable(CalendarDateSchema), undefined),
	description: v.optional(v.nullable(DeviceTypeDescriptionSchema), undefined),
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
	default_device_role_id: NullableIdSchema,
})

export const RackTypeCreateSchema = v.strictObject({
	manufacturer_id: IdSchema,
	model: NameSchema,
	form_factor: RackFormFactorSchema,
	u_height: RackHeightSchema,
	description: DescriptionSchema,
	comments: CommentsSchema,
})

export const RackTypeUpdateSchema = v.strictObject({
	manufacturer_id: v.optional(IdSchema, undefined),
	model: v.optional(NameSchema, undefined),
	form_factor: v.optional(RackFormFactorSchema, undefined),
	u_height: v.optional(RackHeightSchema, undefined),
	description: NullableDescriptionSchema,
	comments: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))), undefined),
})

/** Display names of the PoE types, written like the Wi-Fi interface types. */
export const POE_TYPE_NAMES: Record<PoeType, string> = {
	'type1-ieee802.3af': 'PoE (IEEE 802.3af, 15 W)',
	'type2-ieee802.3at': 'PoE+ (IEEE 802.3at, 30 W)',
	'type3-ieee802.3bt': 'PoE++ (IEEE 802.3bt, 60 W)',
	'type4-ieee802.3bt': 'PoE++ (IEEE 802.3bt, 100 W)',
}

/** Short PoE type names for tight spots; `POE_TYPE_NAMES` has the standard. */
export const POE_TYPE_SHORT_NAMES: Record<PoeType, string> = {
	'type1-ieee802.3af': 'PoE 15 W',
	'type2-ieee802.3at': 'PoE+ 30 W',
	'type3-ieee802.3bt': 'PoE++ 60 W',
	'type4-ieee802.3bt': 'PoE++ 100 W',
}

/** Stub fields besides the name. */
// biome-ignore lint/nursery/useExplicitType: valibot schema inference must stay unannotated
const StubFieldEntries = { ...PortStubFieldEntries, rear_stub_id: v.optional(IdSchema, undefined) }

/**
 * Template stub. `side` makes it a patch-panel stub: rear stubs carry
 * `positions`, front stubs map onto a rear stub of the same type starting
 * at slot `rear_position` (expansion in `server/src/services/templates.ts`).
 */
export const StubCreateSchema = v.pipe(
	v.strictObject({ prefix: InterfacePrefixSchema, ...StubFieldEntries }),
	v.check(
		(s) => s.positions === undefined || s.positions === 1 || s.side === 'rear',
		'Positions are only allowed on rear ports',
	),
	v.check(
		(s) =>
			(s.rear_stub_id === undefined && s.rear_position === undefined) || s.side === 'front',
		'A rear port mapping is only allowed on front ports',
	),
	v.check(
		(s) => s.side !== 'front' || s.rear_stub_id !== undefined,
		'Front ports need a rear port',
	),
)

/** Stub patch; the side is fixed after create. */
export const StubUpdateSchema = v.strictObject({
	prefix: v.optional(InterfacePrefixSchema, undefined),
	count: v.optional(StubCountSchema, undefined),
	digits: v.optional(StubDigitsSchema, undefined),
	start: v.optional(StubStartSchema, undefined),
	kind: v.optional(InterfaceKindSchema, undefined),
	positions: v.optional(PortPositionsSchema, undefined),
	rear_stub_id: v.optional(IdSchema, undefined),
	rear_position: v.optional(PortPositionsSchema, undefined),
	face: v.optional(v.nullable(PanelFaceSchema), undefined),
	...StubPowerEntries,
})

export type ManufacturerCreate = v.InferOutput<typeof ManufacturerCreateSchema>
export type ManufacturerUpdate = v.InferOutput<typeof ManufacturerUpdateSchema>
export type DeviceTypeCreate = v.InferOutput<typeof DeviceTypeCreateSchema>
export type DeviceTypeUpdate = v.InferOutput<typeof DeviceTypeUpdateSchema>
export type RackTypeCreate = v.InferOutput<typeof RackTypeCreateSchema>
export type RackTypeUpdate = v.InferOutput<typeof RackTypeUpdateSchema>
export type StubCreate = v.InferOutput<typeof StubCreateSchema>
export type StubUpdate = v.InferOutput<typeof StubUpdateSchema>
/** EOL state of a device type; several values match any of them. */
export const DEVICE_TYPE_EOL_FILTERS = ['past', 'announced', 'none'] as const
export type DeviceTypeEolFilter = (typeof DEVICE_TYPE_EOL_FILTERS)[number]

export const ManufacturerListQuerySchema = v.object({
	...ListQueryEntries,
	sort: v.optional(
		v.picklist([
			'name',
			'description',
			'website',
			'support_url',
			'device_types',
			'rack_types',
			'devices',
			'past_eol',
		]),
		'name',
	),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const DeviceTypeListQuerySchema = v.object({
	...ListQueryEntries,
	manufacturer: OptionalIdListEntry,
	/** Default role, including its child roles. */
	role: OptionalIdListEntry,
	full_depth: v.optional(looseBoolean(false), undefined),
	eol: v.optional(
		v.pipe(
			CsvListSchema,
			v.array(v.picklist(DEVICE_TYPE_EOL_FILTERS)),
			v.transform(emptyAsUndefined),
		),
		undefined,
	),
	sort: v.optional(
		v.picklist([
			'model',
			'manufacturer',
			'part_number',
			'role',
			'description',
			'comments',
			'u_height',
			'is_full_depth',
			'spec_url',
			'eol_date',
			'devices',
		]),
		'model',
	),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const RackTypeListQuerySchema = v.object({
	...ListQueryEntries,
	manufacturer: OptionalIdListEntry,
	form_factor: v.optional(
		v.pipe(CsvListSchema, v.array(RackFormFactorSchema), v.transform(emptyAsUndefined)),
		undefined,
	),
	/** Rack units (`u_height`). */
	height: v.optional(
		v.pipe(
			CsvListSchema,
			v.array(
				v.pipe(v.union([v.string(), v.number()]), v.transform(Number), RackHeightSchema),
			),
			v.transform(emptyAsUndefined),
		),
		undefined,
	),
	sort: v.optional(
		v.picklist([
			'model',
			'manufacturer',
			'form_factor',
			'u_height',
			'description',
			'comments',
			'racks',
		]),
		'model',
	),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type ManufacturerListQuery = v.InferOutput<typeof ManufacturerListQuerySchema>
export type RackTypeListQuery = v.InferOutput<typeof RackTypeListQuerySchema>
export type DeviceTypeListQuery = v.InferOutput<typeof DeviceTypeListQuerySchema>

/** Port fields a device type owns; everything else stays per device. */
export const TEMPLATE_SYNC_FIELDS = ['kind', 'positions', 'rear_port'] as const
export type TemplateSyncField = (typeof TEMPLATE_SYNC_FIELDS)[number]

export interface TemplateSyncChange {
	field: TemplateSyncField
	from: string | null
	to: string | null
}

/**
 * `GET /devices/:id/template-sync`: how a device's ports differ from its
 * device type. Ports match on side and name; `orphaned` ports have no
 * counterpart in the type and `added` ports none on the device, so an
 * orphaned port can be remapped onto an added port of its side.
 */
export interface TemplateSyncPreview {
	unchanged: number
	updated: {
		interface_id: number
		name: string
		side: PortSide | null
		changes: TemplateSyncChange[]
	}[]
	orphaned: {
		interface_id: number
		name: string
		side: PortSide | null
		kind: string
		connected: boolean
		/** Has a location or a floor plan placement, which removing the port deletes. */
		located: boolean
		/** Has a custom name linked to a template port that is gone. */
		linked: boolean
		/** Name of the added port this one most likely became (same side and kind). */
		suggestion: string | null
	}[]
	added: { name: string; side: PortSide | null; kind: string }[]
	/**
	 * The device's role and its type's default role when they differ; null
	 * when they match or the type has no default role.
	 */
	role: { from: { id: number; name: string }; to: { id: number; name: string } } | null
}

/**
 * `POST /devices/:id/template-sync`: the decision for every orphaned port.
 * `map` takes on the name of the added port in `target`; `link` makes the
 * port that template port under its own name; `keep` leaves the port as it
 * is; `remove` deletes it (refused while it is cabled). `device_role_id`
 * takes on the type's default role, which must still be that role.
 */
export const TemplateSyncApplySchema = v.strictObject({
	device_role_id: v.optional(IdSchema),
	assignments: v.pipe(
		v.array(
			v.strictObject({
				interface_id: IdSchema,
				action: v.picklist(['map', 'link', 'keep', 'remove']),
				target: v.optional(v.string()),
			}),
		),
		v.maxLength(5000),
	),
})

export type TemplateSyncApply = v.InferOutput<typeof TemplateSyncApplySchema>
export type TemplateSyncAssignment = TemplateSyncApply['assignments'][number]

// ---------------------------------------------------------------------------
// P3b: device roles (NetBox-style functional roles: `Server`, `Switch`, …).
// Shared catalog data (no tenant column): every device carries exactly one.
// ---------------------------------------------------------------------------

/** Built-in device roles: seeded by migration, never renamed or deleted. */
export const DEVICE_ROLE_KEYS = [
	'pc',
	'server',
	'ap',
	'firewall',
	'cloud-key',
	'switch',
	'patch-panel',
	'printer',
	'modem',
	'telephony',
	'ups',
] as const
export type DeviceRoleKey = (typeof DEVICE_ROLE_KEYS)[number]

/** Icons a device role can show next to its name; the client maps each to a glyph. */
export const DEVICE_ROLE_ICONS = [
	'desktop',
	'laptop',
	'server',
	'switch',
	'router',
	'firewall',
	'access-point',
	'storage',
	'printer',
	'phone',
	'mobile',
	'display',
	'camera',
	'ups',
	'patch-panel',
	'cloud',
	'virtual',
] as const
export type DeviceRoleIcon = (typeof DEVICE_ROLE_ICONS)[number]

export const DeviceRoleIconSchema = v.picklist(DEVICE_ROLE_ICONS)

export const DeviceRoleCreateSchema = v.strictObject({
	name: NameSchema,
	parent_id: NullableIdSchema,
	description: DescriptionSchema,
	icon: v.optional(v.nullable(DeviceRoleIconSchema), undefined),
	can_host_vms: v.optional(v.boolean(), false),
	managed_bundle_id: NullableIdSchema,
})

export const DeviceRoleUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	parent_id: NullableIdSchema,
	description: NullableDescriptionSchema,
	icon: v.optional(v.nullable(DeviceRoleIconSchema), undefined),
	can_host_vms: v.optional(v.boolean(), undefined),
	managed_bundle_id: NullableIdSchema,
})

export type DeviceRoleCreate = v.InferOutput<typeof DeviceRoleCreateSchema>
export type DeviceRoleUpdate = v.InferOutput<typeof DeviceRoleUpdateSchema>

export const DeviceRoleListQuerySchema = v.object({
	...ListQueryEntries,
	parent: OptionalIdEntry,
	can_host_vms: v.optional(looseBoolean(false), undefined),
	/** Effective managed bundle (own or inherited from an ancestor role). */
	bundle: OptionalIdListEntry,
	sort: v.optional(v.picklist(['name', 'description', 'can_host_vms', 'managed_bundle']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type DeviceRoleListQuery = v.InferOutput<typeof DeviceRoleListQuerySchema>

// ---------------------------------------------------------------------------
// P3c: service catalog (MSP operations). Shared catalog data (no tenant
// column): ticket priorities, service levels (SLA:
// service hours plus response/resolution targets per priority).
// ---------------------------------------------------------------------------

export const DEFAULT_PRIORITY_COLOR = '#6b7280'

/** Hex color as produced by `<input type="color">`: `#rrggbb`. */
export const PriorityColorSchema = v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/))

export const PriorityCreateSchema = v.strictObject({
	name: NameSchema,
	/** 1 = most urgent; lists and SLA matrices sort by it. */
	rank: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(99)),
	color: v.optional(PriorityColorSchema, undefined),
	description: DescriptionSchema,
})

export const PriorityUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	color: v.optional(PriorityColorSchema, undefined),
	rank: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(99)), undefined),
	description: NullableDescriptionSchema,
})

export type PriorityCreate = v.InferOutput<typeof PriorityCreateSchema>
export type PriorityUpdate = v.InferOutput<typeof PriorityUpdateSchema>

export const PriorityListQuerySchema = v.object({
	...ListQueryEntries,
	sort: v.optional(v.picklist(['rank', 'name', 'description']), 'rank'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type PriorityListQuery = v.InferOutput<typeof PriorityListQuerySchema>

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** `HH:MM`, 00:00–24:00 (24:00 only makes sense as an end time). */
const TimeOfDaySchema = v.pipe(
	v.string(),
	v.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Must be a time HH:MM'),
)

/**
 * One weekday's service window; times compare as strings since they are
 * zero-padded. An empty `from` and `to` mean the whole day (24 hours).
 */
export const ServiceWindowSchema = v.pipe(
	v.strictObject({
		day: v.picklist(WEEKDAYS),
		from: v.union([TimeOfDaySchema, v.literal('')]),
		to: v.union([TimeOfDaySchema, v.literal('')]),
	}),
	v.check((w) => (w.from === '') === (w.to === ''), 'Set both start and end, or neither'),
	v.check((w) => w.from === '' || w.from < w.to, 'Service window must end after it starts'),
)

export type ServiceWindow = v.InferOutput<typeof ServiceWindowSchema>

/** Service hours: at most one window per weekday; days without one are closed. */
export const ServiceHoursSchema = v.pipe(
	v.array(ServiceWindowSchema),
	v.check(
		(windows) => new Set(windows.map((w) => w.day)).size === windows.length,
		'Each weekday may have only one service window',
	),
)

/**
 * German federal states (ISO 3166-2) whose public holidays pause the SLA
 * clock in addition to the nationwide ones.
 */
export const HOLIDAY_REGIONS = [
	'DE-BW',
	'DE-BY',
	'DE-BE',
	'DE-BB',
	'DE-HB',
	'DE-HH',
	'DE-HE',
	'DE-MV',
	'DE-NI',
	'DE-NW',
	'DE-RP',
	'DE-SL',
	'DE-SN',
	'DE-ST',
	'DE-SH',
	'DE-TH',
] as const
export type HolidayRegion = (typeof HOLIDAY_REGIONS)[number]

export const HolidayRegionSchema = v.picklist(HOLIDAY_REGIONS)

/** Upper bound of a target: one year, in minutes. */
const MAX_TARGET_MINUTES = 365 * 24 * 60

const TargetMinutesSchema = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(1),
	v.maxValue(MAX_TARGET_MINUTES),
)

/**
 * Response/resolution target of one priority, in minutes. The clock runs
 * only within the service hours unless `around_the_clock` is set (e.g. a
 * 24/7 emergency line for P1). No resolution time = best effort.
 */
export const ServiceLevelTargetSchema = v.pipe(
	v.strictObject({
		priority_id: IdSchema,
		response_minutes: TargetMinutesSchema,
		resolution_minutes: v.optional(v.nullable(TargetMinutesSchema), null),
		around_the_clock: v.optional(v.boolean(), false),
	}),
	v.check(
		(t) => t.resolution_minutes === null || t.resolution_minutes >= t.response_minutes,
		'Resolution time must not be shorter than the response time',
	),
)

export type ServiceLevelTarget = v.InferOutput<typeof ServiceLevelTargetSchema>

/** Targets of one service level: at most one per priority. */
const ServiceLevelTargetsSchema = v.pipe(
	v.array(ServiceLevelTargetSchema),
	v.check(
		(targets) => new Set(targets.map((t) => t.priority_id)).size === targets.length,
		'Each priority may have only one target',
	),
)

export const ServiceLevelCreateSchema = v.strictObject({
	name: NameSchema,
	description: DescriptionSchema,
	service_hours: v.optional(ServiceHoursSchema, []),
	holiday_region: v.optional(v.nullable(HolidayRegionSchema), undefined),
	targets: v.optional(ServiceLevelTargetsSchema, []),
})

/** `service_hours` and `targets` replace the stored set when present. */
export const ServiceLevelUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	description: NullableDescriptionSchema,
	service_hours: v.optional(ServiceHoursSchema, undefined),
	holiday_region: v.optional(v.nullable(HolidayRegionSchema), undefined),
	targets: v.optional(ServiceLevelTargetsSchema, undefined),
})

export type ServiceLevelCreate = v.InferOutput<typeof ServiceLevelCreateSchema>
export type ServiceLevelUpdate = v.InferOutput<typeof ServiceLevelUpdateSchema>

export const ServiceLevelListQuerySchema = v.object({
	...ListQueryEntries,
	sort: v.optional(v.picklist(['name', 'description', 'holiday_region', 'targets']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type ServiceLevelListQuery = v.InferOutput<typeof ServiceLevelListQuerySchema>

/** A stored target with its priority, as returned by the API (sorted by rank). */
export interface ServiceLevelTargetJson {
	priority_id: number
	priority_name: string
	priority_rank: number
	response_minutes: number
	resolution_minutes: number | null
	around_the_clock: boolean
}

/**
 * How a bundle's monthly lots are counted (`/billing`). A bundle bills one
 * or more metrics, each at most once:
 * - `objects`: devices and VMs whose role falls under the bundle
 * - `base`: one per contract (base price)
 * - `wlan`: one when the tenant has an access point (`ap` role subtree)
 * - `switch_ports`: connected ports of the tenant's switches (`switch`
 *   role subtree); stands in for active ports until a source reports them
 * - `m365_users`: users of the last Microsoft 365 sync of the tenant
 * - `backed_up`: devices and VMs of the tenant marked as backed up
 * - `storage`: stored backup data in GB, entered per month; one lot per
 *   started `step_gb`
 */
export const BILLING_METRICS = [
	'objects',
	'base',
	'wlan',
	'switch_ports',
	'm365_users',
	'backed_up',
	'storage',
] as const

export const BillingMetricSchema = v.picklist(BILLING_METRICS)

export type BillingMetric = v.InferOutput<typeof BillingMetricSchema>

/** Default size of one storage lot. */
export const STORAGE_STEP_GB_DEFAULT = 500

export const BillingMetricConfigSchema = v.strictObject({
	metric: BillingMetricSchema,
	/** `storage` only: GB per lot; defaults to `STORAGE_STEP_GB_DEFAULT`. */
	step_gb: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000)),
		undefined,
	),
})

export type BillingMetricConfig = v.InferOutput<typeof BillingMetricConfigSchema>

const BillingMetricsSchema = v.pipe(
	v.array(BillingMetricConfigSchema),
	v.maxLength(BILLING_METRICS.length),
	v.check(
		(list) => new Set(list.map((m) => m.metric)).size === list.length,
		'Each billing metric may appear only once',
	),
)

/** Managed-service bundles (`Workplace`, `Server`, …) device roles map onto. */
export const ManagedBundleCreateSchema = v.strictObject({
	name: NameSchema,
	description: DescriptionSchema,
	billing_metrics: v.optional(BillingMetricsSchema, [{ metric: 'objects' }]),
})

export const ManagedBundleUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	description: NullableDescriptionSchema,
	billing_metrics: v.optional(BillingMetricsSchema, undefined),
})

export type ManagedBundleCreate = v.InferOutput<typeof ManagedBundleCreateSchema>
export type ManagedBundleUpdate = v.InferOutput<typeof ManagedBundleUpdateSchema>

export const ManagedBundleListQuerySchema = v.object({
	...ListQueryEntries,
	sort: v.optional(v.picklist(['name', 'description', 'role_count', 'tenant_count']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type ManagedBundleListQuery = v.InferOutput<typeof ManagedBundleListQuerySchema>

/**
 * `GET /devices/:id/service`: the bundle a device falls under (via its
 * role) and the SLA its tenant contracted for that bundle.
 */
export interface DeviceServiceJson {
	managed_bundle: { id: number; name: string } | null
	service_level: { id: number; name: string } | null
}

// ---------------------------------------------------------------------------
// P4: devices / interfaces
// ---------------------------------------------------------------------------

/** Device lifecycle label. */
export const DeviceStatusSchema = v.picklist([
	'active',
	'inactive',
	'planned',
	'staged',
	'decommissioned',
])

export type DeviceStatus = v.InferOutput<typeof DeviceStatusSchema>

/** Interface name label (e.g. `eth1`). Same charset as stub prefixes. */
export const InterfaceNameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(100),
	v.regex(PORT_NAME_PATTERN, PORT_NAME_MESSAGE),
)

const OptionalNullablePositionEntry = v.optional(
	v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
	undefined,
)

/** Rack face a device is mounted on. Only meaningful for rack-mounted devices. */
export const DeviceFaceSchema = v.picklist(['front', 'rear'])

export type DeviceFace = v.InferOutput<typeof DeviceFaceSchema>

/** Employees assigned to a device, without duplicates (order is irrelevant). */
const DeviceEmployeeIdsSchema = v.pipe(
	v.array(IdSchema),
	v.maxLength(100),
	v.check((ids) => new Set(ids).size === ids.length, 'Employees must be unique'),
)

export const DeviceCreateSchema = v.strictObject({
	device_type_id: IdSchema,
	device_role_id: IdSchema,
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
	device_id: DeviceIdSchema,
	tenant_id: NullableIdSchema,
	employee_ids: v.optional(DeviceEmployeeIdsSchema, []),
	/** Counted for the `backed_up` billing metric; omitted = false. */
	backed_up: v.optional(v.boolean(), undefined),
	description: DescriptionSchema,
})

export const DeviceUpdateSchema = v.strictObject({
	// device_type_id is immutable after create: swapping the template would
	// silently invalidate the expanded interface set and the U footprint.
	device_role_id: v.optional(IdSchema, undefined),
	name: v.optional(NameSchema, undefined),
	status: v.optional(DeviceStatusSchema, undefined),
	site_id: NullableIdSchema,
	location_id: NullableIdSchema,
	rack_id: NullableIdSchema,
	face: v.optional(v.nullable(DeviceFaceSchema), undefined),
	position_u: v.optional(v.nullable(PositionUSchema), undefined),
	shelf_id: NullableIdSchema,
	serial: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
	asset_tag: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
	device_id: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
	tenant_id: NullableIdSchema,
	/** Replaces the whole assignment; omitted keeps it. */
	employee_ids: v.optional(DeviceEmployeeIdsSchema, undefined),
	backed_up: v.optional(v.boolean(), undefined),
	description: NullableDescriptionSchema,
})

/**
 * Explicit remount body: `undefined` keeps the current value, `null` clears
 * it. At least one key must be present so an empty body fails loudly.
 */
export const DeviceMoveSchema = v.pipe(
	v.strictObject({
		rack_id: NullableIdSchema,
		position_u: OptionalNullablePositionEntry,
	}),
	v.check(
		(m) => m.rack_id !== undefined || m.position_u !== undefined,
		'Provide at least one of rack_id or position_u',
	),
)

/**
 * `POST /devices/:id/swap`: two U-mounted devices of one rack trade places.
 * Each takes over the other's face; the pair keeps the U range it covers
 * (the upper device ends up at the bottom of it, the lower one at the top).
 */
export const DeviceSwapSchema = v.strictObject({
	other_id: IdSchema,
})

/**
 * `POST /devices/:id/migrate`: hands a device's role in the network over to
 * a replacement (`target_id`). `ports` moves the cable of each old port
 * (`from`) onto a free port of the replacement (`to`); cables of unlisted
 * ports stay. `placement` takes over site, location, rack mount or shelf and
 * the floor-plan markers; `assignment` the tenant and the employees; `vms`
 * the hosted virtual machines; `name` the name. `status` is the old device's
 * new status; omitted keeps it.
 */
export const DeviceMigrateSchema = v.strictObject({
	target_id: IdSchema,
	ports: v.pipe(
		v.array(v.strictObject({ from: IdSchema, to: IdSchema })),
		v.maxLength(5000),
		v.check(
			(pairs) => new Set(pairs.map((pair) => pair.from)).size === pairs.length,
			'Each port can only move once',
		),
		v.check(
			(pairs) => new Set(pairs.map((pair) => pair.to)).size === pairs.length,
			'Each port of the new device takes at most one cable',
		),
	),
	placement: v.boolean(),
	assignment: v.boolean(),
	vms: v.boolean(),
	name: v.boolean(),
	status: v.optional(DeviceStatusSchema, undefined),
})

export type DeviceMigrate = v.InferOutput<typeof DeviceMigrateSchema>

/**
 * Port create body. `side` makes it a patch-panel port: rear ports carry
 * `positions`, front ports name a rear port of the same device and a slot
 * on it.
 */
export const InterfaceCreateSchema = v.pipe(
	v.strictObject({
		name: InterfaceNameSchema,
		kind: v.optional(InterfaceKindSchema, 'ethernet'),
		enabled: v.optional(v.boolean(), undefined),
		side: v.optional(v.nullable(PortSideSchema), undefined),
		positions: v.optional(PortPositionsSchema, undefined),
		rear_port_id: v.optional(IdSchema, undefined),
		rear_port_position: v.optional(PortPositionsSchema, undefined),
	}),
	v.check(
		(i) => i.positions === undefined || i.positions === 1 || i.side === 'rear',
		'Positions are only allowed on rear ports',
	),
	v.check(
		(i) =>
			(i.rear_port_id === undefined && i.rear_port_position === undefined) ||
			i.side === 'front',
		'A rear port mapping is only allowed on front ports',
	),
	v.check(
		(i) => i.side !== 'front' || i.rear_port_id !== undefined,
		'Front ports need a rear port',
	),
)

/** Port patch; the side is fixed after create. */
export const InterfaceUpdateSchema = v.strictObject({
	// `connected` is owned by P5 cables, never edited directly.
	name: v.optional(InterfaceNameSchema, undefined),
	kind: v.optional(InterfaceKindSchema, undefined),
	enabled: v.optional(v.boolean(), undefined),
	positions: v.optional(PortPositionsSchema, undefined),
	rear_port_id: v.optional(IdSchema, undefined),
	rear_port_position: v.optional(PortPositionsSchema, undefined),
	// Outlets (single-position rear ports) only: the room the cable ends in.
	// A placed outlet takes it from its floor plan and rejects it here.
	location_id: NullableIdSchema,
	// Patch-panel ports only: wired up, or just part of the panel.
	patched: v.optional(v.boolean(), undefined),
})

/**
 * `GET /locations/:id/outlets`: an outlet located in the location or one
 * of its descendants, with its panel and the port cabled to it.
 */
export interface LocationOutletJson {
	/** The outlet (rear port) interface. */
	id: number
	/** Port name on the panel (`12`). */
	name: string
	connected: boolean
	/** The panel device. */
	device_id: number
	device_name: string
	location_id: number
	location_name: string
	/** Port at the other end of the outlet's cable, if any. */
	peer: { device_id: number; device_name: string; interface_name: string } | null
}

export type DeviceCreate = v.InferOutput<typeof DeviceCreateSchema>
export type DeviceUpdate = v.InferOutput<typeof DeviceUpdateSchema>
export type DeviceMove = v.InferOutput<typeof DeviceMoveSchema>
export type DeviceSwap = v.InferOutput<typeof DeviceSwapSchema>
export type InterfaceCreate = v.InferOutput<typeof InterfaceCreateSchema>
export type InterfaceUpdate = v.InferOutput<typeof InterfaceUpdateSchema>

/** Jack names also allow slashes and the separator used for generated names. */
const JackNameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(100),
	v.regex(
		/^[A-Za-z0-9_.+\x2f-]+$/,
		'Must be letters, digits, dot, dash, underscore, slash, or plus',
	),
)

/**
 * `POST /devices/:id/jacks`: groups outlets (single-position rear ports
 * of the panel, in no jack yet) into one jack. Their locations must agree:
 * ports without one take the others'. A placed port's marker becomes the
 * jack's; the other ports' markers are removed.
 */
export const PanelJackCreateSchema = v.strictObject({
	name: JackNameSchema,
	interface_ids: v.pipe(v.array(IdSchema), v.minLength(2), v.maxLength(48)),
})

export type PanelJackCreate = v.InferOutput<typeof PanelJackCreateSchema>

/**
 * `PATCH /devices/:id/jacks/:jackId`: rename a jack and/or set its ports.
 * `interface_ids` lists all its ports: added outlets (free ones of the
 * panel) join as on create, removed ones become single outlets again.
 */
export const PanelJackUpdateSchema = v.strictObject({
	name: v.optional(JackNameSchema, undefined),
	interface_ids: v.optional(
		v.pipe(v.array(IdSchema), v.minLength(2), v.maxLength(48)),
		undefined,
	),
})

export type PanelJackUpdate = v.InferOutput<typeof PanelJackUpdateSchema>

export const DeviceJackParamsSchema = v.object({ id: IdSchema, jackId: IdSchema })

/** Jack of a patch panel; its ports carry `jack_id`, in port order. */
export interface PanelJackJson {
	id: number
	device_id: number
	name: string
	interface_ids: number[]
}

// ---------------------------------------------------------------------------
// Virtual machines (on a host device, or hostless: cloud / IaaS). A hosted
// VM carries its host's tenant, so `tenant_id` is only accepted for
// hostless VMs (enforced in the service layer).
// ---------------------------------------------------------------------------

export const VirtualMachineCreateSchema = v.strictObject({
	host_device_id: NullableIdSchema,
	device_role_id: IdSchema,
	name: NameSchema,
	status: v.optional(DeviceStatusSchema, 'active'),
	tenant_id: NullableIdSchema,
	employee_id: NullableIdSchema,
	/** Counted for the `backed_up` billing metric; omitted = false. */
	backed_up: v.optional(v.boolean(), undefined),
	description: DescriptionSchema,
})

export const VirtualMachineUpdateSchema = v.strictObject({
	host_device_id: NullableIdSchema,
	device_role_id: v.optional(IdSchema, undefined),
	name: v.optional(NameSchema, undefined),
	status: v.optional(DeviceStatusSchema, undefined),
	tenant_id: NullableIdSchema,
	employee_id: NullableIdSchema,
	backed_up: v.optional(v.boolean(), undefined),
	description: NullableDescriptionSchema,
})

export type VirtualMachineCreate = v.InferOutput<typeof VirtualMachineCreateSchema>
export type VirtualMachineUpdate = v.InferOutput<typeof VirtualMachineUpdateSchema>

/** Row kinds of the device list: physical devices and virtual machines. */
export const DEVICE_LIST_KINDS = ['device', 'vm'] as const

export const DeviceListKindSchema = v.picklist(DEVICE_LIST_KINDS)

export type DeviceListKind = v.InferOutput<typeof DeviceListKindSchema>

export const DeviceListQuerySchema = v.object({
	...ListQueryEntries,
	site: OptionalIdEntry,
	/** Devices directly in this location (hides VMs). */
	location: OptionalIdEntry,
	rack: OptionalIdListEntry,
	role: OptionalIdListEntry,
	device_type: OptionalIdEntry,
	/** Devices whose type comes from this manufacturer (hides VMs). */
	manufacturer: OptionalIdEntry,
	employee: OptionalIdListEntry,
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
	status: v.optional(DeviceStatusSchema, undefined),
	/** `true` hides inactive devices and VMs, `false` lists only those. */
	active: v.optional(looseBoolean(false), undefined),
	/** Placed = U-mounted; unplaced = neither mounted nor rack-assigned. */
	placed: v.optional(looseBoolean(false), undefined),
	/** Devices only, VMs only, or both (omitted). */
	kind: v.optional(DeviceListKindSchema, undefined),
	/** VMs running on this host device (hides devices). */
	host: OptionalIdEntry,
	/** Devices with a port that can be cabled to this interface (hides VMs). */
	compatible_with: OptionalIdEntry,
	/** Devices whose type is at least 1 U high, i.e. can be U-mounted (hides VMs). */
	mountable: v.optional(looseBoolean(false), undefined),
	/** Devices whose type is past its EOL date, or the others when false (hides VMs). */
	past_eol: v.optional(looseBoolean(false), undefined),
	sort: v.optional(
		v.picklist([
			'name',
			'status',
			'device_id',
			'role',
			'type',
			'mount',
			'employee',
			'tenant',
			'site',
			'location',
			'floorplan',
			'serial',
			'asset_tag',
			'description',
		]),
		'name',
	),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export const InterfaceListQuerySchema = v.object({
	...ListQueryEntries,
	device: OptionalIdEntry,
	connected: v.optional(looseBoolean(false), undefined),
})

export type DeviceListQuery = v.InferOutput<typeof DeviceListQuerySchema>

// ---------------------------------------------------------------------------
// Shelves (rack fixtures, fully separate from devices)
// ---------------------------------------------------------------------------

/** U height of the shelf mount hardware: 0 = dummy shelf without a mounting band. */
export const ShelfMountHeightSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(60))

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
	description: NullableDescriptionSchema,
})

export type ShelfCreate = v.InferOutput<typeof ShelfCreateSchema>
export type ShelfUpdate = v.InferOutput<typeof ShelfUpdateSchema>

export const ShelfListQuerySchema = v.object({
	...ListQueryEntries,
	rack: OptionalIdEntry,
	sort: v.optional(v.picklist(['name']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

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
	description: NullableDescriptionSchema,
})

/** Convenience connect body: `POST` one end in the path, the peer in the body. */
export const InterfaceConnectSchema = v.strictObject({
	peer_interface_id: IdSchema,
})

export type CableCreate = v.InferOutput<typeof CableCreateSchema>
export type CableUpdate = v.InferOutput<typeof CableUpdateSchema>

export const CableListQuerySchema = v.object({
	...ListQueryEntries,
	status: v.optional(CableStatusSchema, undefined),
	/** Filter to cables touching this interface (either end). */
	interface: OptionalIdEntry,
	/** Filter to cables touching any interface of this device (either end). */
	device: OptionalIdEntry,
})

/** One peer link in a per-device trace. */
export interface TracePeerInterface {
	id: number
	name: string
	kind: string
	/** Patch-panel side; `null` for a normal port. */
	side: PortSide | null
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

/**
 * One cable hop in a multi-hop trace path (`from` -> `to`). After a hop
 * into a patch panel, the next hop's `from_interface` is the paired port
 * the signal passed through to.
 */
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
	/**
	 * The path fanned out of a multi-position rear port without a known
	 * position (NetBox split), so it is one of several possible circuits.
	 */
	split: boolean
}

/** One patch panel an end-to-end circuit passes through. */
export interface TracePanelPass {
	device: TracePeerDevice
	in_interface: TracePeerInterface
	/** Port the signal leaves the panel by; `null` when no front port maps the slot. */
	out_interface: TracePeerInterface | null
}

/**
 * End-to-end peer of a port cabled to a patch panel: the far end after
 * every panel on the way, e.g. "→ PC-123 via PP-A 12 · PP-B 12".
 */
export interface TraceEndToEnd {
	local_interface_id: number
	/** Far end; `null` when the circuit ends at an uncabled panel port. */
	end_device: TracePeerDevice | null
	end_interface: TracePeerInterface | null
	via: TracePanelPass[]
	split: boolean
}

export interface DeviceTraceResponse {
	device_id: number
	links: TraceLink[]
	/** Shortest-path multi-hop traces (depth-limited, see TraceQuerySchema). */
	paths: TracePath[]
	/** End-to-end peers of the local ports cabled to a patch panel. */
	end_to_end: TraceEndToEnd[]
}

/** Per-interface trace: all shortest paths starting at one port. */
export interface InterfaceTraceResponse {
	start_device: TracePeerDevice
	start_interface: TracePeerInterface
	paths: TracePath[]
	/** End-to-end peers when the port is cabled to a patch panel. */
	end_to_end: TraceEndToEnd[]
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

// ---------------------------------------------------------------------------
// P7: users / roles / permissions
// ---------------------------------------------------------------------------

/**
 * Permissions a role can grant. `view` / `edit` / `delete` cover every
 * inventory and catalog resource at once (`edit` = create + update,
 * including CSV import). The rest gate the admin areas. The two
 * integration permissions are cumulative like view / edit / delete:
 * `integrations.write` uses the configured providers (reports, syncs,
 * links, imports, pushing changes), `integrations.manage` (granted together
 * with `integrations.write`) also configures them (credentials, enable,
 * remove, full syncs, Microsoft 365 consent, the calendar sync);
 * `tickets.create` opens tickets in the external ticket system (TANSS);
 * `contacts.directory` reads the contact directory (`/directory/contacts`),
 * e.g. for the AGFEO Dashboard LDAP plugin. `employees.tenants` changes the
 * tenants of existing employees (with `edit`), which also changes the
 * tenant scope of the employee's account. `ai.use` sends prompts to the
 * configured AI provider (`[ai]` in the server config). `settings.manage`
 * edits the global settings (`/global-settings`), e.g. the default AI models.
 * `billing.manage` reads, snapshots and finalizes the monthly lot counts
 * (`/billing`).
 */
export const PERMISSIONS = [
	'view',
	'edit',
	'delete',
	'users.manage',
	'employees.tenants',
	'changelog.view',
	'audit_log.view',
	'integrations.write',
	'integrations.manage',
	'tickets.create',
	'contacts.directory',
	'ai.use',
	'settings.manage',
	'billing.manage',
] as const

export const PermissionSchema = v.picklist(PERMISSIONS)

export type Permission = v.InferOutput<typeof PermissionSchema>

const PermissionListSchema = v.pipe(
	v.array(PermissionSchema),
	v.transform((list) => PERMISSIONS.filter((p) => list.includes(p))),
)

/** Identity of the signed-in user, returned by `GET /auth/me` and parsed by the client. */
export const SessionUserSchema = v.object({
	username: v.string(),
	role: v.object({ id: v.number(), name: v.string() }),
	permissions: v.array(v.picklist(PERMISSIONS)),
	/** Tenants the user is limited to; null when global. */
	tenant_ids: v.nullable(v.array(v.number())),
	/** The employee behind the account, if linked. */
	employee_id: v.nullable(v.number()),
	/**
	 * Role the session views the app as ("view as role" in the account
	 * settings); null = own role. `permissions` are this role's while set,
	 * `role` stays the user's own.
	 */
	view_as: v.nullable(v.object({ id: v.number(), name: v.string() })),
})

export type SessionUser = v.InferOutput<typeof SessionUserSchema>

/** `PUT /auth/view-as`: the role to view the app as, null to return to the own role. */
export const ViewAsSchema = v.strictObject({
	role_id: v.nullable(IdSchema),
})

/** A role offered by `GET /auth/view-as`: one granting nothing the user's own role lacks. */
export interface ViewAsRoleJson {
	id: number
	name: string
	description: string | null
}

/**
 * Roles bundle permissions and are assigned to users (one role per user).
 * Users whose role grants `users.manage` are always global (no tenant
 * scope); everyone else with tenants is strictly limited to them
 * (null-tenant rows are invisible to them).
 */
export const RoleCreateSchema = v.strictObject({
	name: NameSchema,
	description: DescriptionSchema,
	permissions: v.optional(PermissionListSchema, []),
})

export const RoleUpdateSchema = v.strictObject({
	name: v.optional(NameSchema, undefined),
	description: NullableDescriptionSchema,
	permissions: v.optional(PermissionListSchema, undefined),
})

export const RoleListQuerySchema = v.object({
	...ListQueryEntries,
	sort: v.optional(v.picklist(['name', 'description', 'users']), 'name'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

/** Role as returned by `/roles`; `user_count` drives the delete guard in the UI. */
export interface RoleJson {
	id: number
	name: string
	description: string | null
	permissions: Permission[]
	user_count: number
}

export type RoleCreate = v.InferOutput<typeof RoleCreateSchema>
export type RoleUpdate = v.InferOutput<typeof RoleUpdateSchema>
export type RoleListQuery = v.InferOutput<typeof RoleListQuerySchema>

/**
 * Accounts of employees carry the person (name, mail, tenants) and sign in
 * with the employee's primary mail address, so `username` is only given
 * (and required) without `employee_id`. Their tenant scope is exactly the
 * employee's tenants. Accounts without employee carry their own scope in
 * `tenant_ids` (empty = global); it must be empty with `employee_id` and for
 * roles granting `users.manage`.
 */
const UserTenantIdsSchema = v.pipe(
	v.array(IdSchema),
	v.maxLength(500),
	v.transform((ids) => [...new Set(ids)]),
)

export const UserCreateSchema = v.strictObject({
	username: v.optional(UsernameSchema, undefined),
	password: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
	role_id: IdSchema,
	tenant_ids: v.optional(UserTenantIdsSchema, []),
	employee_id: NullableIdSchema,
})

export const UserUpdateSchema = v.strictObject({
	role_id: v.optional(IdSchema, undefined),
	tenant_ids: v.optional(UserTenantIdsSchema, undefined),
	employee_id: NullableIdSchema,
	password: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(1024)), undefined),
})

export const UserListQuerySchema = v.object({
	...ListQueryEntries,
	role: OptionalIdListEntry,
	tenant: OptionalIdEntry,
	employee: OptionalIdEntry,
	sort: v.optional(v.picklist(['username', 'employee', 'role']), 'username'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

/** Public user shape: password hashes never leave the server. */
export interface UserJson {
	id: number
	username: string
	role_id: number
	role_name: string
	/**
	 * Tenant scope: the employee's tenants for linked accounts, else the
	 * account's own; empty = global (all tenants).
	 */
	tenant_ids: number[]
	/** Linked employee (the person behind the account), if any. */
	employee_id: number | null
	employee_name: string | null
	/** False when the linked employee is inactive: the account cannot sign in. */
	active: boolean
}

export type UserCreate = v.InferOutput<typeof UserCreateSchema>
export type UserUpdate = v.InferOutput<typeof UserUpdateSchema>
export type UserListQuery = v.InferOutput<typeof UserListQuerySchema>

// ---------------------------------------------------------------------------
// Audit log (admin-only, read-only)
// ---------------------------------------------------------------------------

/**
 * `password.change`: a user changed their own password. `password.reset`: a
 * user manager set another account's password (`target_username`).
 */
export const AUDIT_EVENTS = [
	'login.success',
	'login.failure',
	'password.change',
	'password.reset',
] as const

export const AuditEventSchema = v.picklist(AUDIT_EVENTS)

export type AuditEvent = v.InferOutput<typeof AuditEventSchema>

/** `search` matches username, target username, peer IP or forwarded-for. Defaults to newest first. */
export const AuditLogListQuerySchema = v.object({
	...ListQueryEntries,
	event: v.optional(
		v.pipe(CsvListSchema, v.array(AuditEventSchema), v.transform(emptyAsUndefined)),
		undefined,
	),
	sort: v.optional(
		v.picklist(['created_at', 'event', 'username', 'target_username', 'ip', 'user_agent']),
		'created_at',
	),
	order: v.optional(v.picklist(['asc', 'desc']), 'desc'),
})

export type AuditLogListQuery = v.InferOutput<typeof AuditLogListQuerySchema>

export interface AuditLogEntryJson {
	id: number
	/** Unix seconds. */
	created_at: number
	event: AuditEvent
	/** Acting user (for logins, the attempted username). */
	username: string
	user_id: number | null
	/** Account acted upon when it differs from the actor (`password.reset`). */
	target_username: string | null
	/** Socket peer address. */
	ip: string
	/** Raw `X-Forwarded-For` header, if sent (client-controlled). */
	forwarded_for: string | null
	user_agent: string | null
}

// ---------------------------------------------------------------------------
// Attachments: images owned by one site, location or rack
// ---------------------------------------------------------------------------

/** Accepted image types, detected server-side from the magic bytes. */
export const ATTACHMENT_MIMES = ['image/png', 'image/jpeg'] as const

export type AttachmentMime = (typeof ATTACHMENT_MIMES)[number]

/** Upload limit per image file. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/** Exactly one of the three owner keys must be set. */
function hasOneOwner(...owners: (number | undefined)[]): boolean {
	return owners.filter((id) => id !== undefined).length === 1
}

const ONE_OWNER = 'Exactly one of site, location or rack is required'

/** Multipart file field: presence and size; the type is checked from the bytes. */
const AttachmentFileSchema = v.pipe(
	v.file('A file is required'),
	v.maxSize(ATTACHMENT_MAX_BYTES, 'Image is larger than 10 MB'),
)

/** `?site=`, `?location=` or `?rack=`: the attachments of one owner. */
export const AttachmentListQuerySchema = v.pipe(
	v.object({
		site: OptionalIdEntry,
		location: OptionalIdEntry,
		rack: OptionalIdEntry,
	}),
	v.check((q) => hasOneOwner(q.site, q.location, q.rack), ONE_OWNER),
)

/** Multipart upload body (form fields arrive as strings). */
export const AttachmentCreateSchema = v.pipe(
	v.strictObject({
		file: AttachmentFileSchema,
		site_id: v.optional(IdSchema, undefined),
		location_id: v.optional(IdSchema, undefined),
		rack_id: v.optional(IdSchema, undefined),
		description: DescriptionSchema,
	}),
	v.check((body) => hasOneOwner(body.site_id, body.location_id, body.rack_id), ONE_OWNER),
)

/** Multipart body of a file replace. */
export const AttachmentFileReplaceSchema = v.strictObject({ file: AttachmentFileSchema })

export const AttachmentUpdateSchema = v.strictObject({
	description: NullableDescriptionSchema,
	/** Marks the attachment as its site's or location's floor plan (unmarking the previous one). */
	is_floorplan: v.optional(v.boolean(), undefined),
})

export type AttachmentUpdate = v.InferOutput<typeof AttachmentUpdateSchema>

/** Attachment row on the wire (the image itself is `GET /attachments/:id/file`). */
export interface AttachmentJson {
	id: number
	/** Owner: exactly one of `site_id` / `location_id` / `rack_id` is set. */
	site_id: number | null
	location_id: number | null
	rack_id: number | null
	/** Original file name. */
	filename: string
	mime: AttachmentMime
	size_bytes: number
	width_px: number
	height_px: number
	/** Random per stored file, so it changes on replace and doubles as a cache key. */
	storage_key: string
	is_floorplan: boolean
	description: string | null
	/** Unix seconds. */
	created_at: number
	created_by: number | null
}

// ---------------------------------------------------------------------------
// Floor plans: areas and markers on an owner's marked attachment
// ---------------------------------------------------------------------------

/** Normalized image coordinate: 0 is the left/top edge, 1 the right/bottom one. */
const FloorplanCoordSchema = v.pipe(
	v.number('Coordinate must be a number'),
	v.minValue(0, 'Coordinate must be between 0 and 1'),
	v.maxValue(1, 'Coordinate must be between 0 and 1'),
)

/** `[x, y]` pair of normalized coordinates. */
export type FloorplanPoint = [number, number]

/** Maximum number of points in a floor-plan area polygon. */
export const MAX_AREA_POINTS = 100

/**
 * Area linking to one site or location, or outlining one device (a machine
 * that takes up floor space): a polygon of at least three points.
 */
const FloorplanAreaInputSchema = v.pipe(
	v.strictObject({
		site_id: v.optional(IdSchema, undefined),
		location_id: v.optional(IdSchema, undefined),
		device_id: v.optional(IdSchema, undefined),
		/** Shown instead of the target's name; empty or missing shows the name. */
		label: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
		points: v.pipe(
			v.array(v.tuple([FloorplanCoordSchema, FloorplanCoordSchema])),
			v.minLength(3, 'An area needs at least 3 points'),
			v.maxLength(MAX_AREA_POINTS, `An area has at most ${MAX_AREA_POINTS} points`),
		),
	}),
	v.check(
		(area) => hasOneOwner(area.site_id, area.location_id, area.device_id),
		'Exactly one of site, location or device is required as the area target',
	),
)

/** What a marker places: exactly one of a rack, device, outlet port or jack. */
const PlacementTargetEntries = {
	rack_id: v.optional(IdSchema, undefined),
	device_id: v.optional(IdSchema, undefined),
	interface_id: v.optional(IdSchema, undefined),
	jack_id: v.optional(IdSchema, undefined),
}

function placesOneObject(placement: {
	rack_id?: number
	device_id?: number
	interface_id?: number
	jack_id?: number
}): boolean {
	return (
		[placement.rack_id, placement.device_id, placement.interface_id, placement.jack_id].filter(
			(id) => id !== undefined,
		).length === 1
	)
}

const PLACES_ONE_OBJECT = 'Exactly one of rack, device, port or jack is required'

/**
 * Rack, device or outlet marker at a normalized position. An outlet is a
 * single-position rear port of a patch panel outside any jack, or a jack.
 */
const FloorplanPlacementInputSchema = v.pipe(
	v.strictObject({ ...PlacementTargetEntries, x: FloorplanCoordSchema, y: FloorplanCoordSchema }),
	v.check((placement) => placesOneObject(placement), PLACES_ONE_OBJECT),
)

/**
 * Scale of a plan: two points on it and their real distance in whole
 * centimeters. The length per image pixel follows with the image's size, so the scale
 * survives a file replace with the same proportions.
 */
export const FloorplanScaleSchema = v.pipe(
	v.strictObject({
		a: v.tuple([FloorplanCoordSchema, FloorplanCoordSchema]),
		b: v.tuple([FloorplanCoordSchema, FloorplanCoordSchema]),
		centimeters: v.pipe(
			v.number('Distance must be a number'),
			v.integer('Distance must be whole centimeters'),
			v.minValue(1, 'Distance must be at least 1 cm'),
			v.maxValue(10_000_000, 'Distance must be at most 10000000 cm'),
		),
	}),
	v.check(
		(scale) => scale.a[0] !== scale.b[0] || scale.a[1] !== scale.b[1],
		'The two scale points must differ',
	),
)

export type FloorplanScale = v.InferOutput<typeof FloorplanScaleSchema>

/**
 * `PUT /attachments/:id/plan`: the full set of areas and placements, plus the
 * scale and origin, replaced atomically. A missing scale or origin clears it.
 */
export const FloorplanPutSchema = v.strictObject({
	areas: v.pipe(v.array(FloorplanAreaInputSchema), v.maxLength(500)),
	placements: v.pipe(v.array(FloorplanPlacementInputSchema), v.maxLength(2000)),
	scale: v.optional(v.nullable(FloorplanScaleSchema), null),
	/** Zero point of the plan's coordinates (x right, y up), in normalized coordinates. */
	origin: v.optional(v.nullable(v.tuple([FloorplanCoordSchema, FloorplanCoordSchema])), null),
})

export type FloorplanPut = v.InferOutput<typeof FloorplanPutSchema>

/** Area on the wire, with its target resolved for display and linking. */
export interface FloorplanAreaJson {
	id: number
	/** Target: exactly one of `site_id` / `location_id` / `device_id` is set. */
	site_id: number | null
	location_id: number | null
	device_id: number | null
	/** Custom label; `null` shows `target_name`. */
	label: string | null
	points: FloorplanPoint[]
	target_name: string
	/** Location type of a location target; `null` for a site or device. */
	target_type: LocationType | null
	/** Floor plan (attachment) of a site or location target, if it has one marked. */
	target_plan_id: number | null
	/** Status of a device target; `null` for a site or location. */
	status: string | null
	/** Icon of a device target's role; `null` otherwise or for a role without one. */
	role_icon: DeviceRoleIcon | null
}

/** One rear port of an outlet. */
export interface FloorplanOutletPortJson {
	id: number
	/** Port name on the panel (`12`). */
	name: string
	/** Connector kind (`8p8c`, `lc`, …): copper or fiber. */
	kind: string
	connected: boolean
}

/**
 * Outlet on a floor plan: a patch-panel rear port, or a jack of several,
 * with its panel and whether it is cabled.
 */
export interface FloorplanPortJson {
	/** The panel device. */
	device_id: number
	device_name: string
	/** Port name on the panel (`12`), or the jack's name. */
	name: string
	/** Some port of the outlet is cabled. */
	connected: boolean
	/** The outlet's ports in port order: one, or those of the jack. */
	ports: FloorplanOutletPortJson[]
}

/** Marker on the wire, with its rack, device or outlet resolved for display. */
export interface FloorplanPlacementJson {
	id: number
	/** Exactly one of `rack_id` / `device_id` / `interface_id` / `jack_id` is set. */
	rack_id: number | null
	device_id: number | null
	interface_id: number | null
	jack_id: number | null
	/** Outlet details; `null` for a rack or device. */
	port: FloorplanPortJson | null
	x: number
	y: number
	/** Rack or device name; `PP-A 12` for an outlet. */
	name: string
	/** Device status; `null` for a rack. */
	status: string | null
	/** Icon of the device's role; `null` for a rack or a role without one. */
	role_icon: DeviceRoleIcon | null
}

/**
 * `GET /attachments/:id/plan`. Areas and placements whose target or object
 * lies outside the requester's tenant scope are left out.
 */
export interface FloorplanJson {
	attachment_id: number
	areas: FloorplanAreaJson[]
	placements: FloorplanPlacementJson[]
	/** Real-world scale; `null` until set. */
	scale: FloorplanScale | null
	/** Zero point of the coordinates (x right, y up); `null` is the top-left corner. */
	origin: FloorplanPoint | null
	/** Warn before clearing a plan even when some content is outside the scope. */
	has_hidden_content: boolean
}

/**
 * `?confirm=floorplan` on `DELETE /sites/:id`, `/locations/:id` and
 * `/attachments/:id`: also delete when floor-plan data is affected.
 * `?confirm=contents` on `DELETE /sites/:id` and `/tenants/:id`: also delete
 * the contained rows (`DeleteContentsJson`) and their floor-plan data.
 */
export const DeleteQuerySchema = v.object({
	confirm: v.optional(v.picklist(['floorplan', 'contents']), undefined),
})

export type DeleteQuery = v.InferOutput<typeof DeleteQuerySchema>

/** Floor-plan data a delete would remove (the 409 body's `floorplan`). */
export interface FloorplanImpactJson {
	/** Areas on the deleted object's own floor plan. */
	areas: number
	/** Markers on the deleted object's own floor plan. */
	placements: number
	/** Areas on floor plans that link to (or outline) the deleted object. */
	linkedFrom: number
	/** The deleted object's own drawn floor plan with content (0 or 1). */
	drawings: number
}

/** Contained rows a site or tenant delete takes with it (the 409 body's `contents`). */
export interface DeleteContentsJson {
	sites: number
	site_groups: number
	locations: number
}

/**
 * 409 body of a delete that needs confirming: `?confirm=contents` when it
 * carries `contents`, else `?confirm=floorplan`.
 */
export interface DeleteImpactErrorJson {
	error: string
	floorplan: FloorplanImpactJson
	contents?: DeleteContentsJson
}

/**
 * `GET /attachments/floorplan-links?site=|location=|rack=|device=`: plans
 * that place the rack or device (as a marker, or a device as an area), or
 * that have an area linking to the site or location. Plans whose owner the
 * requester cannot see are left out.
 */
export const FloorplanLinksQuerySchema = v.pipe(
	v.object({
		site: OptionalIdEntry,
		location: OptionalIdEntry,
		rack: OptionalIdEntry,
		device: OptionalIdEntry,
		interface: OptionalIdEntry,
	}),
	v.check(
		(q) =>
			[q.site, q.location, q.rack, q.device, q.interface].filter((id) => id !== undefined)
				.length === 1,
		'Exactly one of site, location, rack, device or interface is required',
	),
)

export type FloorplanLinksQuery = v.InferOutput<typeof FloorplanLinksQuerySchema>

/**
 * `GET /attachments/outlets?device=`: placed outlets of a device. For a
 * patch panel its own placed rear ports; for any other device the placed
 * rear ports its ports are cabled to.
 */
export const FloorplanOutletsQuerySchema = v.object({ device: IdSchema })

/** One placed outlet seen from a device (`FloorplanOutletsQuerySchema`). */
export interface FloorplanOutletJson {
	/** The device's port: the rear port itself on a panel, else the port cabled to it. */
	local_interface_id: number
	/** The rear port: placed itself, or through its jack. */
	interface_id: number
	/** The placed outlet: the port, or its jack. */
	port: FloorplanPortJson
	attachment_id: number
	/** Owner of the plan: exactly one of `site_id` / `location_id` is set. */
	site_id: number | null
	location_id: number | null
	owner_name: string
}

/** Floor plan referencing an object, identified by its owner. */
export interface FloorplanLinkJson {
	attachment_id: number
	/** Owner of the plan: exactly one of `site_id` / `location_id` is set. */
	site_id: number | null
	location_id: number | null
	owner_name: string
}

/**
 * `GET /attachments/:id/plan/candidates`: racks and devices the editor may
 * place on this plan. They lie in the owner's scope (its site, or the
 * location and its descendants), are visible to the requester and are not
 * placed on another plan. Those already on this plan are included.
 * Devices in a rack (`devices.rack_id` set) are never candidates: the rack
 * view manages them. A legacy marker of one stays on the plan until removed.
 */
export interface FloorplanCandidateJson {
	/** Exactly one of `rack_id` / `device_id` / `interface_id` / `jack_id` is set. */
	rack_id: number | null
	device_id: number | null
	/** Unplaced single-position rear port of a patch panel in the owner's site, in no jack. */
	interface_id: number | null
	/** Unplaced jack of such ports. */
	jack_id: number | null
	port: FloorplanPortJson | null
	/** Rack or device name; `PP-A 12` for an outlet. */
	name: string
	/** Device status; `null` for a rack. */
	status: string | null
	/** Icon of the device's role; `null` for a rack or a role without one. */
	role_icon: DeviceRoleIcon | null
	/** Location of the object, for grouping in the palette; `null` directly on the site. */
	location_id: number | null
	location_name: string | null
}

/**
 * `GET /attachments/floorplans?search=&page=&limit=&tenant=&tenant_group=`:
 * the marked floor plans, filtered by their owner's tenant and searched by
 * owner or site name.
 */
export const FloorplanListQuerySchema = v.object({
	...ListQueryEntries,
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
	/** Default: by site, then owner name. */
	sort: v.optional(v.picklist(['owner', 'type', 'site', 'tenant']), 'site'),
	order: v.optional(v.picklist(['asc', 'desc']), 'asc'),
})

export type FloorplanListQuery = v.InferOutput<typeof FloorplanListQuerySchema>

/** Floor plan row of the `/floorplans` list. */
export interface FloorplanListJson {
	attachment_id: number
	/** Owner of the plan: exactly one of `site_id` / `location_id` is set. */
	site_id: number | null
	location_id: number | null
	owner_name: string
	/** Location type of a location owner; `null` for a site. */
	location_type: LocationType | null
	/** The owner's site (the owner itself for a site). */
	site_name: string
	tenant_id: number | null
	tenant_name: string | null
	areas: number
	placements: number
}

// ---------------------------------------------------------------------------
// Drawn floor plans (v2): walls, doors, windows, stairs and markers drawn on a sheet
// in centimeters, optionally over a reference image
// ---------------------------------------------------------------------------

/** Largest sheet side and coordinate of a drawn plan: 1 km. */
export const MAX_DRAWING_CM = 100_000

/** Default sheet of a new drawn plan: 20 m × 15 m. */
export const DEFAULT_DRAWING_SIZE = { width: 2000, height: 1500 } as const

/** Position on a drawn plan's sheet in centimeters, from its top-left corner. */
const DrawingCoordSchema = v.pipe(
	v.number('Coordinate must be a number'),
	v.minValue(0, 'Coordinate must lie on the sheet'),
	v.maxValue(MAX_DRAWING_CM, 'Coordinate must lie on the sheet'),
)

const DrawingPointSchema = v.tuple([DrawingCoordSchema, DrawingCoordSchema])

const SheetSideSchema = v.pipe(
	v.number('Sheet size must be a number'),
	v.minValue(100, 'The sheet must be at least 1 m wide and high'),
	v.maxValue(MAX_DRAWING_CM, 'The sheet must be at most 1 km wide and high'),
)

/** Highest anything stands or hangs above the floor of a drawn plan, cm. */
export const MAX_DRAWING_HEIGHT = 2000

/** A height or elevation above the floor, cm; `min` is the lowest allowed. */
function heightSchema(
	what: string,
	min: number,
): v.SchemaWithPipe<
	readonly [
		v.NumberSchema<string>,
		v.MinValueAction<number, number, string>,
		v.MaxValueAction<number, number, string>,
	]
> {
	return v.pipe(
		v.number(`${what} must be a number`),
		v.minValue(min, `${what} is at least ${min} cm`),
		v.maxValue(MAX_DRAWING_HEIGHT, `${what} is at most ${MAX_DRAWING_HEIGHT} cm`),
	)
}

/**
 * Default mounting height of a new marker, cm: racks stand on the floor,
 * outlets sit in the lower installation zone (DIN 18015-3).
 */
export const DEFAULT_MARKER_ELEVATION = { rack: 0, device: 120, outlet: 30 } as const

/** The default mounting height of a marker of `placement`'s kind, cm. */
export function defaultMarkerElevation(placement: {
	rack_id?: number | null
	device_id?: number | null
}): number {
	if (placement.rack_id !== undefined && placement.rack_id !== null) {
		return DEFAULT_MARKER_ELEVATION.rack
	}
	return placement.device_id !== undefined && placement.device_id !== null
		? DEFAULT_MARKER_ELEVATION.device
		: DEFAULT_MARKER_ELEVATION.outlet
}

/**
 * Rack, device or outlet marker on a drawn plan, at a position in cm, and
 * mounted `elevation` cm above the floor (a rack's base, a device's or
 * outlet's center); missing, it takes its kind's default.
 */
const DrawingPlacementInputSchema = v.pipe(
	v.strictObject({
		...PlacementTargetEntries,
		x: DrawingCoordSchema,
		y: DrawingCoordSchema,
		elevation: v.optional(heightSchema('Mounting height', 0), undefined),
	}),
	v.check((placement) => placesOneObject(placement), PLACES_ONE_OBJECT),
	v.transform((placement) => ({
		...placement,
		elevation: placement.elevation ?? defaultMarkerElevation(placement),
	})),
)

/** Thinnest and thickest wall, cm. */
export const MIN_WALL_THICKNESS = 1
export const MAX_WALL_THICKNESS = 200

/** Lowest wall, cm. */
export const MIN_WALL_HEIGHT = 10

/** Default height of a new wall, cm: the usual clear room height of 2.50 m. */
export const DEFAULT_WALL_HEIGHT = 250

/** Usual storey height, floor to floor, cm: the room height and the floor slab. */
export const DEFAULT_STOREY_HEIGHT = 275

/**
 * A straight wall from `a` to `b` (cm) with its thickness (cm), centered on
 * the line, and `height` cm high.
 */
export const FloorplanWallSchema = v.pipe(
	v.strictObject({
		a: DrawingPointSchema,
		b: DrawingPointSchema,
		thickness: v.pipe(
			v.number('Wall thickness must be a number'),
			v.minValue(MIN_WALL_THICKNESS, `Walls are at least ${MIN_WALL_THICKNESS} cm thick`),
			v.maxValue(MAX_WALL_THICKNESS, `Walls are at most ${MAX_WALL_THICKNESS} cm thick`),
		),
		height: v.optional(heightSchema('Wall height', MIN_WALL_HEIGHT), DEFAULT_WALL_HEIGHT),
	}),
	v.check((wall) => wall.a[0] !== wall.b[0] || wall.a[1] !== wall.b[1], 'A wall needs a length'),
)

export type FloorplanWall = v.InferOutput<typeof FloorplanWallSchema>

export const OPENING_KINDS = ['door', 'sliding_door', 'window'] as const

export type OpeningKind = (typeof OPENING_KINDS)[number]

/** Narrowest and widest door or window, cm. */
export const MIN_OPENING_WIDTH = 10
export const MAX_OPENING_WIDTH = 2000

/** Lowest door or window, cm. */
export const MIN_OPENING_HEIGHT = 10

/**
 * Default sill (bottom above the floor) and height of a new door, sliding
 * door and window, cm: the 2010 mm rough opening of a standard door (DIN
 * 18101), a window 1260 mm high above a 90 cm parapet.
 */
export const DEFAULT_OPENING_HEIGHT: Record<OpeningKind, { sill: number; height: number }> = {
	door: { sill: 0, height: 201 },
	sliding_door: { sill: 0, height: 201 },
	window: { sill: 90, height: 126 },
}

/**
 * Door or window in a wall (`wall` is its index in `walls`): centered
 * `offset` cm from the wall's start `a`, `width` cm wide. Seen from `a` to
 * `b`, a door hinges at the end of the opening facing `hinge` and swings to
 * `side`; a sliding door runs along the wall's `side` face and slides open
 * toward `hinge`. A window ignores both. The opening starts `sill` cm above
 * the floor and is `height` cm high (missing, its kind's default); above it
 * the wall closes again.
 */
export const FloorplanOpeningSchema = v.pipe(
	v.strictObject({
		wall: v.pipe(v.number(), v.integer(), v.minValue(0)),
		kind: v.picklist(OPENING_KINDS),
		offset: v.pipe(v.number('Offset must be a number'), v.minValue(0)),
		width: v.pipe(
			v.number('Width must be a number'),
			v.minValue(
				MIN_OPENING_WIDTH,
				`Doors and windows are at least ${MIN_OPENING_WIDTH} cm wide`,
			),
			v.maxValue(
				MAX_OPENING_WIDTH,
				`Doors and windows are at most ${MAX_OPENING_WIDTH} cm wide`,
			),
		),
		hinge: v.picklist(['start', 'end']),
		side: v.picklist(['left', 'right']),
		sill: v.optional(heightSchema('Sill height', 0), undefined),
		height: v.optional(heightSchema('Door and window height', MIN_OPENING_HEIGHT), undefined),
	}),
	v.transform((opening) => ({
		...opening,
		sill: opening.sill ?? DEFAULT_OPENING_HEIGHT[opening.kind].sill,
		height: opening.height ?? DEFAULT_OPENING_HEIGHT[opening.kind].height,
	})),
)

export type FloorplanOpening = v.InferOutput<typeof FloorplanOpeningSchema>

/** Narrowest and widest stairs, cm. */
export const MIN_STAIR_WIDTH = 30
export const MAX_STAIR_WIDTH = 1000

/** Fewest and most steps of one flight of stairs. */
export const MIN_STAIR_STEPS = 2
export const MAX_STAIR_STEPS = 100

/** Lowest rise of a flight of stairs, cm. */
export const MIN_STAIR_RISE = 10

/** Usual rise of one step, cm (17/29 stairs, DIN 18065). */
export const STAIR_RISER = 17

/** Default rise of a new flight of `steps` steps, cm: usual steps, a storey at most. */
export function defaultStairRise(steps: number): number {
	return Math.min(steps * STAIR_RISER, DEFAULT_STOREY_HEIGHT)
}

/**
 * A straight flight of stairs from `a` (its foot) up to `b` (its head), cm,
 * `width` cm wide and centered on that line, with `steps` treads of equal
 * depth, climbing `rise` cm in all (missing, usual steps up to a storey).
 */
export const FloorplanStairSchema = v.pipe(
	v.strictObject({
		a: DrawingPointSchema,
		b: DrawingPointSchema,
		width: v.pipe(
			v.number('Stair width must be a number'),
			v.minValue(MIN_STAIR_WIDTH, `Stairs are at least ${MIN_STAIR_WIDTH} cm wide`),
			v.maxValue(MAX_STAIR_WIDTH, `Stairs are at most ${MAX_STAIR_WIDTH} cm wide`),
		),
		steps: v.pipe(
			v.number('Steps must be a number'),
			v.integer('Steps must be a whole number'),
			v.minValue(MIN_STAIR_STEPS, `Stairs have at least ${MIN_STAIR_STEPS} steps`),
			v.maxValue(MAX_STAIR_STEPS, `Stairs have at most ${MAX_STAIR_STEPS} steps`),
		),
		rise: v.optional(heightSchema('The rise of stairs', MIN_STAIR_RISE), undefined),
	}),
	v.check(
		(stair) => stair.a[0] !== stair.b[0] || stair.a[1] !== stair.b[1],
		'Stairs need a length',
	),
	v.transform((stair) => ({ ...stair, rise: stair.rise ?? defaultStairRise(stair.steps) })),
)

export type FloorplanStair = v.InferOutput<typeof FloorplanStairSchema>

/** Narrowest and widest cable tray, cm. */
export const MIN_TRAY_WIDTH = 5
export const MAX_TRAY_WIDTH = 200

/** Default mounting height of a new cable tray (its bottom), cm: 20 cm below a 2.50 m ceiling. */
export const DEFAULT_TRAY_ELEVATION = 230

/**
 * A straight run of cable tray from `a` to `b` (cm), `width` cm wide and
 * centered on that line, its bottom `elevation` cm above the floor (0 lies
 * on the floor). Runs meeting at an end form bends and junctions, like walls.
 */
export const FloorplanTraySchema = v.pipe(
	v.strictObject({
		a: DrawingPointSchema,
		b: DrawingPointSchema,
		width: v.pipe(
			v.number('Tray width must be a number'),
			v.minValue(MIN_TRAY_WIDTH, `Cable trays are at least ${MIN_TRAY_WIDTH} cm wide`),
			v.maxValue(MAX_TRAY_WIDTH, `Cable trays are at most ${MAX_TRAY_WIDTH} cm wide`),
		),
		elevation: v.optional(heightSchema('Cable tray height', 0), DEFAULT_TRAY_ELEVATION),
	}),
	v.check(
		(tray) => tray.a[0] !== tray.b[0] || tray.a[1] !== tray.b[1],
		'A cable tray needs a length',
	),
)

export type FloorplanTray = v.InferOutput<typeof FloorplanTraySchema>

/** Smallest and largest side (or diameter) of a pillar, cm. */
export const MIN_PILLAR_SIDE = 5
export const MAX_PILLAR_SIDE = 500

export const PILLAR_SHAPES = ['rect', 'round'] as const

export type PillarShape = (typeof PILLAR_SHAPES)[number]

const PillarSideSchema = v.pipe(
	v.number('Pillar size must be a number'),
	v.minValue(MIN_PILLAR_SIDE, `Pillars are at least ${MIN_PILLAR_SIDE} cm across`),
	v.maxValue(MAX_PILLAR_SIDE, `Pillars are at most ${MAX_PILLAR_SIDE} cm across`),
)

/**
 * A pillar (column) standing at `center` (cm): a `width` × `depth` cm
 * rectangle, or a round one (`width` across, `depth` the same), turned
 * `rotation` degrees clockwise, `height` cm high (missing, a room high).
 */
export const FloorplanPillarSchema = v.strictObject({
	center: DrawingPointSchema,
	shape: v.picklist(PILLAR_SHAPES),
	width: PillarSideSchema,
	depth: PillarSideSchema,
	rotation: v.pipe(
		v.number('Rotation must be a number'),
		v.minValue(0, 'Rotation is at least 0°'),
		v.maxValue(360, 'Rotation is at most 360°'),
	),
	height: v.optional(heightSchema('Pillar height', MIN_WALL_HEIGHT), DEFAULT_WALL_HEIGHT),
})

export type FloorplanPillar = v.InferOutput<typeof FloorplanPillarSchema>

/** Thinnest and thickest room divider, cm. */
export const MIN_PARTITION_THICKNESS = 1
export const MAX_PARTITION_THICKNESS = 50

/** Lowest room divider, and the default height of a new one, cm: an office partition screen. */
export const MIN_PARTITION_HEIGHT = 10
export const DEFAULT_PARTITION_HEIGHT = 160

/**
 * A straight room divider (a partition screen, shelf or glass partition
 * that does not reach the ceiling) from `a` to `b` (cm), `thickness` cm
 * thick and centered on that line, `height` cm high. Dividers meeting at
 * an end form corners, like walls, but take no doors or windows.
 */
export const FloorplanPartitionSchema = v.pipe(
	v.strictObject({
		a: DrawingPointSchema,
		b: DrawingPointSchema,
		thickness: v.pipe(
			v.number('Divider thickness must be a number'),
			v.minValue(
				MIN_PARTITION_THICKNESS,
				`Room dividers are at least ${MIN_PARTITION_THICKNESS} cm thick`,
			),
			v.maxValue(
				MAX_PARTITION_THICKNESS,
				`Room dividers are at most ${MAX_PARTITION_THICKNESS} cm thick`,
			),
		),
		height: v.optional(
			heightSchema('Room divider height', MIN_PARTITION_HEIGHT),
			DEFAULT_PARTITION_HEIGHT,
		),
	}),
	v.check(
		(partition) => partition.a[0] !== partition.b[0] || partition.a[1] !== partition.b[1],
		'A room divider needs a length',
	),
)

export type FloorplanPartition = v.InferOutput<typeof FloorplanPartitionSchema>

/** Shallowest and deepest desk, cm. */
export const MIN_DESK_DEPTH = 20
export const MAX_DESK_DEPTH = 500

/** Lowest and highest desk top, and the default of a new desk (DIN EN 527-1), cm. */
export const MIN_DESK_HEIGHT = 20
export const MAX_DESK_HEIGHT = 200
export const DEFAULT_DESK_HEIGHT = 74

const DeskHeightSchema = v.optional(
	v.pipe(
		v.number('Desk height must be a number'),
		v.minValue(MIN_DESK_HEIGHT, `Desks are at least ${MIN_DESK_HEIGHT} cm high`),
		v.maxValue(MAX_DESK_HEIGHT, `Desks are at most ${MAX_DESK_HEIGHT} cm high`),
	),
	DEFAULT_DESK_HEIGHT,
)

/** A location a drawn desk or room links to; missing for a plain drawing. */
const LinkedLocationEntry = v.optional(IdSchema, undefined)

/**
 * A rectangular desk: its back edge from `a` to `b` (cm) and `depth` cm
 * toward the left of `a`→`b` (on screen, y down), its top `height` cm above
 * the floor.
 */
export const FloorplanDeskSchema = v.pipe(
	v.strictObject({
		a: DrawingPointSchema,
		b: DrawingPointSchema,
		depth: v.pipe(
			v.number('Desk depth must be a number'),
			v.minValue(MIN_DESK_DEPTH, `Desks are at least ${MIN_DESK_DEPTH} cm deep`),
			v.maxValue(MAX_DESK_DEPTH, `Desks are at most ${MAX_DESK_DEPTH} cm deep`),
		),
		height: DeskHeightSchema,
		location_id: LinkedLocationEntry,
	}),
	v.check((desk) => desk.a[0] !== desk.b[0] || desk.a[1] !== desk.b[1], 'A desk needs a length'),
)

export type FloorplanDesk = v.InferOutput<typeof FloorplanDeskSchema>

/** Shortest and longest divider of a desk group, cm. */
export const MIN_DESK_GROUP_ARM = 30
export const MAX_DESK_GROUP_ARM = 400

/** Deepest desk group, center to the front corners, cm. */
export const MAX_DESK_GROUP_DEPTH = 800

/**
 * Half the width of the front edge of each desk of a desk group with
 * dividers `arm` cm long, its front corners `depth` cm from the center; not
 * positive when the sides would cross. Each side leaves its divider's outer
 * end at a right angle, so neighboring desks' sides line up.
 */
export function deskGroupFrontHalf(arm: number, depth: number): number {
	const side = ((depth - arm / 2) * 2) / Math.sqrt(3)
	return (arm * Math.sqrt(3)) / 2 - side / 2
}

/** A desk of a desk group links to a location by id, or not (`null`). */
const DeskGroupLinkSchema = v.nullable(IdSchema)

/**
 * Three desks around a center (cm), 120° apart, split by three dividers
 * `arm` cm long. Each desk reaches `depth` cm from the center to its front
 * corners; its front edge curves `curve` cm in toward the center. At
 * `rotation` 0° the first desk faces down and a divider points up; the
 * others follow clockwise. The desk tops lie `height` cm above the floor.
 * `location_ids` holds each desk's link.
 */
export const FloorplanDeskGroupSchema = v.pipe(
	v.strictObject({
		center: DrawingPointSchema,
		rotation: v.pipe(
			v.number('Rotation must be a number'),
			v.minValue(0, 'Rotation is at least 0°'),
			v.maxValue(360, 'Rotation is at most 360°'),
		),
		arm: v.pipe(
			v.number('Divider length must be a number'),
			v.minValue(MIN_DESK_GROUP_ARM, `Dividers are at least ${MIN_DESK_GROUP_ARM} cm long`),
			v.maxValue(MAX_DESK_GROUP_ARM, `Dividers are at most ${MAX_DESK_GROUP_ARM} cm long`),
		),
		depth: v.pipe(
			v.number('Desk depth must be a number'),
			v.minValue(MIN_DESK_DEPTH, `Desks are at least ${MIN_DESK_DEPTH} cm deep`),
			v.maxValue(
				MAX_DESK_GROUP_DEPTH,
				`Desk groups are at most ${MAX_DESK_GROUP_DEPTH} cm deep`,
			),
		),
		curve: v.pipe(v.number('Front curve must be a number'), v.minValue(0)),
		height: DeskHeightSchema,
		location_ids: v.tuple([DeskGroupLinkSchema, DeskGroupLinkSchema, DeskGroupLinkSchema]),
	}),
	v.check(
		(group) => group.depth > group.arm / 2 && deskGroupFrontHalf(group.arm, group.depth) > 0,
		"A desk group's depth must be more than half and less than twice its divider length",
	),
	v.check(
		(group) =>
			group.curve <=
			Math.min(deskGroupFrontHalf(group.arm, group.depth), group.depth - group.arm / 2),
		'The front curve is too deep for this desk group',
	),
)

export type FloorplanDeskGroup = v.InferOutput<typeof FloorplanDeskGroupSchema>

/** Most corners of a drawn room. */
export const MAX_ROOM_POINTS = 200

/**
 * A room: a polygon of at least three corners (cm), optionally linked to a
 * location and labelled (the label shows instead of the location's name).
 */
export const FloorplanRoomSchema = v.strictObject({
	points: v.pipe(
		v.array(DrawingPointSchema),
		v.minLength(3, 'A room needs at least 3 corners'),
		v.maxLength(MAX_ROOM_POINTS, `A room has at most ${MAX_ROOM_POINTS} corners`),
	),
	location_id: LinkedLocationEntry,
	label: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(100))), undefined),
})

export type FloorplanRoom = v.InferOutput<typeof FloorplanRoomSchema>

/** A location a desk or room of a drawn plan links to, or may link to. */
export interface FloorplanLinkLocationJson {
	id: number
	name: string
	type: LocationType
	parent_id: number | null
}

/**
 * Reference image under a drawn plan: an image attachment of the same
 * owner, its top-left corner at (`x`, `y`) cm (it may stick out of the
 * sheet) and `width` cm wide; the height follows from its aspect ratio.
 */
export const FloorplanReferenceSchema = v.strictObject({
	attachment_id: IdSchema,
	x: v.pipe(v.number(), v.minValue(-10 * MAX_DRAWING_CM), v.maxValue(MAX_DRAWING_CM)),
	y: v.pipe(v.number(), v.minValue(-10 * MAX_DRAWING_CM), v.maxValue(MAX_DRAWING_CM)),
	width: v.pipe(
		v.number('Image width must be a number'),
		v.minValue(1, 'The image must be at least 1 cm wide'),
		v.maxValue(10 * MAX_DRAWING_CM, 'The image is too wide'),
	),
})

export type FloorplanReference = v.InferOutput<typeof FloorplanReferenceSchema>

/** Lowest and highest storey of a building: basements below 0, the ground floor 0. */
export const MIN_FLOOR_LEVEL = -20
export const MAX_FLOOR_LEVEL = 200

/**
 * Storey of a drawn plan in its building (the owning location's parent),
 * or `null` for a plan that is not stacked with the other floors.
 */
const FloorLevelSchema = v.nullable(
	v.pipe(
		v.number('Storey must be a number'),
		v.integer('Storey must be a whole number'),
		v.minValue(MIN_FLOOR_LEVEL, `Storeys go down to ${MIN_FLOOR_LEVEL}`),
		v.maxValue(MAX_FLOOR_LEVEL, `Storeys go up to ${MAX_FLOOR_LEVEL}`),
	),
)

const OffsetCoordSchema = v.pipe(
	v.number('Offset must be a number'),
	v.minValue(-MAX_DRAWING_CM, 'The offset is at most 1 km'),
	v.maxValue(MAX_DRAWING_CM, 'The offset is at most 1 km'),
)

/**
 * Where a drawn plan's sheet lies in its building's frame: the building
 * point (cm) of the sheet's top-left corner. Floors of one building share
 * that frame, so a point `p` of one floor lies above or below `p + offset`
 * of the building and `p + offset - other.offset` of another floor.
 */
export const FloorplanOffsetSchema = v.strictObject({
	x: OffsetCoordSchema,
	y: OffsetCoordSchema,
})

export type FloorplanOffset = v.InferOutput<typeof FloorplanOffsetSchema>

/** Length of a wall, cm. */
export function wallLength(wall: Pick<FloorplanWall, 'a' | 'b'>): number {
	return Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
}

/** How far a door or window may reach past its wall's ends: rounding slack, cm. */
const OPENING_SLACK = 0.5

/**
 * `PUT /floorplan-drawings/:id`: the sheet, the reference image and the
 * full set of walls, openings, pillars, room dividers, stairs, cable trays,
 * desks, desk groups, rooms and markers, replaced atomically. Everything lies on the sheet; each opening
 * fits into its wall.
 */
export const FloorplanDrawingPutSchema = v.pipe(
	v.strictObject({
		width: SheetSideSchema,
		height: SheetSideSchema,
		reference: v.optional(v.nullable(FloorplanReferenceSchema), null),
		level: v.optional(FloorLevelSchema, null),
		offset: v.optional(FloorplanOffsetSchema, { x: 0, y: 0 }),
		walls: v.pipe(v.array(FloorplanWallSchema), v.maxLength(2000)),
		openings: v.pipe(v.array(FloorplanOpeningSchema), v.maxLength(2000)),
		pillars: v.optional(v.pipe(v.array(FloorplanPillarSchema), v.maxLength(2000)), []),
		partitions: v.optional(v.pipe(v.array(FloorplanPartitionSchema), v.maxLength(2000)), []),
		stairs: v.optional(v.pipe(v.array(FloorplanStairSchema), v.maxLength(500)), []),
		trays: v.optional(v.pipe(v.array(FloorplanTraySchema), v.maxLength(2000)), []),
		desks: v.optional(v.pipe(v.array(FloorplanDeskSchema), v.maxLength(2000)), []),
		desk_groups: v.optional(v.pipe(v.array(FloorplanDeskGroupSchema), v.maxLength(1000)), []),
		rooms: v.optional(v.pipe(v.array(FloorplanRoomSchema), v.maxLength(500)), []),
		placements: v.pipe(v.array(DrawingPlacementInputSchema), v.maxLength(2000)),
	}),
	v.check(
		(plan) =>
			[
				...plan.walls.flatMap((wall) => [wall.a, wall.b]),
				...plan.pillars.map((pillar) => pillar.center),
				...plan.partitions.flatMap((partition) => [partition.a, partition.b]),
				...plan.stairs.flatMap((stair) => [stair.a, stair.b]),
				...plan.trays.flatMap((tray) => [tray.a, tray.b]),
				...plan.desks.flatMap((desk) => [desk.a, desk.b]),
				...plan.desk_groups.map((group) => group.center),
				...plan.rooms.flatMap((room) => room.points),
				...plan.placements.map((p): [number, number] => [p.x, p.y]),
			].every(([x, y]) => x <= plan.width && y <= plan.height),
		'Walls, pillars, dividers, stairs, trays, desks, rooms and markers must lie on the sheet',
	),
	v.check((plan) => {
		return plan.openings.every((opening) => {
			const wall = plan.walls[opening.wall]
			if (!wall) {
				return false
			}
			const half = opening.width / 2
			return (
				opening.offset - half >= -OPENING_SLACK &&
				opening.offset + half <= wallLength(wall) + OPENING_SLACK
			)
		})
	}, 'Each door and window must fit into its wall'),
)

export type FloorplanDrawingPut = v.InferOutput<typeof FloorplanDrawingPutSchema>

/** `POST /floorplan-drawings`: an empty drawn plan for a site or location. */
export const FloorplanDrawingCreateSchema = v.pipe(
	v.strictObject({
		site_id: v.optional(IdSchema, undefined),
		location_id: v.optional(IdSchema, undefined),
		width: v.optional(SheetSideSchema, DEFAULT_DRAWING_SIZE.width),
		height: v.optional(SheetSideSchema, DEFAULT_DRAWING_SIZE.height),
	}),
	v.check(
		(body) => hasOneOwner(body.site_id, body.location_id),
		'Exactly one of site or location is required',
	),
)

export type FloorplanDrawingCreate = v.InferOutput<typeof FloorplanDrawingCreateSchema>

/** `GET /floorplan-drawings/owner?site=|location=`: the owner's drawn plan, if any. */
export const FloorplanDrawingOwnerQuerySchema = v.pipe(
	v.object({ site: OptionalIdEntry, location: OptionalIdEntry }),
	v.check((q) => hasOneOwner(q.site, q.location), 'Exactly one of site or location is required'),
)

export type FloorplanDrawingOwnerQuery = v.InferOutput<typeof FloorplanDrawingOwnerQuerySchema>

/**
 * Marker of a drawn plan: its position (`x` / `y`, cm), its mounting height
 * (cm) and, for a rack with a rack type, the rack's height in units.
 */
export interface FloorplanDrawingPlacementJson extends FloorplanPlacementJson {
	elevation: number
	rack_units: number | null
}

/**
 * `GET /floorplan-drawings/:id`. Markers whose object lies outside the
 * requester's tenant scope are left out.
 */
export interface FloorplanDrawingJson {
	id: number
	/** Owner: exactly one of `site_id` / `location_id` is set. */
	site_id: number | null
	location_id: number | null
	owner_name: string
	/** Sheet size, cm. */
	width: number
	height: number
	/** The reference image and where it lies; `null` without one. */
	reference: (FloorplanReference & { attachment: AttachmentJson }) | null
	/** Storey in the building; `null` when not stacked. */
	level: number | null
	/** Where the sheet lies in the building's frame. */
	offset: FloorplanOffset
	/**
	 * The building whose floors' plans stack with this one: the location the
	 * owner lies in (`location_id`), or for a top-level floor its site
	 * (`location_id` null); `null` for a site's plan or another top-level
	 * location's.
	 */
	building: { location_id: number | null; site_id: number; name: string } | null
	walls: FloorplanWall[]
	openings: FloorplanOpening[]
	pillars: FloorplanPillar[]
	partitions: FloorplanPartition[]
	stairs: FloorplanStair[]
	trays: FloorplanTray[]
	desks: FloorplanDesk[]
	desk_groups: FloorplanDeskGroup[]
	rooms: FloorplanRoom[]
	/**
	 * The locations desks, desk groups and rooms link to, as far as they exist and the
	 * requester may see them; a link missing here is kept on save.
	 */
	linked_locations: FloorplanLinkLocationJson[]
	placements: FloorplanDrawingPlacementJson[]
	/** Some markers are outside the requester's scope (a save keeps them). */
	has_hidden_content: boolean
	/** Unix seconds. */
	updated_at: number
}

/**
 * `GET /floorplan-drawings/:id/stack`: the plans of the other floors of the
 * plan's building, lowest storey first (those without a storey last), as
 * far as the requester may see them.
 */
export interface FloorplanStackFloorJson {
	id: number
	location_id: number
	owner_name: string
	level: number | null
	offset: FloorplanOffset
}

/** `GET /floorplan-drawings/owner`: the owner's drawn plan, or `null`. */
export interface FloorplanDrawingRefJson {
	id: number
}

/**
 * `GET /floorplan-drawings/outlets?device=` (`FloorplanOutletsQuerySchema`):
 * a patch panel's rear ports placed on a drawn plan, by themselves or
 * through their jack.
 */
export interface FloorplanDrawingOutletJson {
	interface_id: number
	drawing_id: number
	owner_name: string
}

/** `GET /floorplan-drawings?search=&page=&limit=&tenant=&tenant_group=`. */
export const FloorplanDrawingListQuerySchema: typeof FloorplanListQuerySchema =
	FloorplanListQuerySchema

/** Drawn floor plan row of the `/floorplans-v2` list. */
export interface FloorplanDrawingListJson {
	id: number
	site_id: number | null
	location_id: number | null
	owner_name: string
	location_type: LocationType | null
	site_name: string
	tenant_id: number | null
	tenant_name: string | null
	walls: number
	placements: number
}

// ---------------------------------------------------------------------------
// Changelog (NetBox-style object change history, read-only)
// ---------------------------------------------------------------------------

export const CHANGE_ACTIONS = ['create', 'update', 'delete'] as const

export const ChangeActionSchema = v.picklist(CHANGE_ACTIONS)

export type ChangeAction = v.InferOutput<typeof ChangeActionSchema>

export const CHANGE_OBJECT_TYPES = [
	'tenant_group',
	'tenant',
	'employee',
	'site_group',
	'site',
	'location',
	'rack',
	'shelf',
	'device',
	'virtual_machine',
	'interface',
	'panel_jack',
	'cable',
	'manufacturer',
	'device_type',
	'rack_type',
	'interface_template',
	'device_role',
	'attachment',
	'floorplan_drawing',
	'priority',
	'service_level',
	'managed_bundle',
] as const

export const ChangeObjectTypeSchema = v.picklist(CHANGE_OBJECT_TYPES)

export type ChangeObjectType = v.InferOutput<typeof ChangeObjectTypeSchema>

/** `search` matches the object name or the username. Defaults to newest first. */
export const ChangelogListQuerySchema = v.object({
	...ListQueryEntries,
	action: v.optional(
		v.pipe(CsvListSchema, v.array(ChangeActionSchema), v.transform(emptyAsUndefined)),
		undefined,
	),
	object_type: v.optional(
		v.pipe(CsvListSchema, v.array(ChangeObjectTypeSchema), v.transform(emptyAsUndefined)),
		undefined,
	),
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
	sort: v.optional(
		v.picklist(['created_at', 'username', 'action', 'object_type', 'object_repr']),
		'created_at',
	),
	order: v.optional(v.picklist(['asc', 'desc']), 'desc'),
})

export type ChangelogListQuery = v.InferOutput<typeof ChangelogListQuerySchema>

export interface ObjectChangeJson {
	id: number
	/** Unix seconds. */
	created_at: number
	/** Null once the user was deleted, or for changes made by the system. */
	user_id: number | null
	/** Name at the time of the change; empty for system changes. */
	username: string
	action: ChangeAction
	object_type: ChangeObjectType
	object_id: number
	/** Object name at the time of the change. */
	object_repr: string
	/** Tenant of the object; null for catalog data and cross-tenant cables. */
	tenant_id: number | null
	/** Object state before the change; null for creations. */
	prechange_data: Record<string, unknown> | null
	/** Object state after the change; null for deletions. */
	postchange_data: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// P6: global search / CSV import
// ---------------------------------------------------------------------------

/** Global search query: `GET /search?q=`. Empty query returns empty groups. */
export const SearchQuerySchema = v.object({
	q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
})

/** JSON body for CSV imports: raw CSV text, parsed row-by-row server-side. */
export const CsvImportBodySchema = v.strictObject({
	csv: v.pipe(v.string(), v.minLength(1), v.maxLength(1_000_000)),
})

/** JSON body for NetBox device-type YAML imports. */
export const YamlImportBodySchema = v.strictObject({
	yaml: v.pipe(v.string(), v.minLength(1), v.maxLength(1_000_000)),
})

/** `POST /device-types/:id/update`: `revision` is the one the reviewed preview was based on. */
export const DeviceTypeUpdateApplySchema = v.strictObject({
	yaml: YamlImportBodySchema.entries.yaml,
	revision: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
})

export type DeviceTypeUpdateApply = v.InferOutput<typeof DeviceTypeUpdateApplySchema>

/**
 * One device CSV row (minimal columns). Device type models and rack/site
 * names resolve to ids server-side; `position_u` arrives as text and
 * coerces through Number.
 */
export const DeviceImportRowSchema = v.object({
	name: NameSchema,
	asset_tag: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), undefined),
	device_id: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), undefined),
	device_type_model: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	device_role_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	site_name: v.optional(
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

/** One cable CSV row: device/interface names resolve to ids server-side. */
export const CableImportRowSchema = v.object({
	a_device: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	a_interface: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	b_device: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	b_interface: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	/** Port side when the name exists on several sides of a panel (NetBox termination type). */
	a_side: v.optional(PortSideSchema, undefined),
	b_side: v.optional(PortSideSchema, undefined),
	label: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), undefined),
	kind: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(50)), undefined),
	status: v.optional(CableStatusSchema, 'connected'),
})

/** Per-row import outcome: created id or the row's error message. */
export interface ImportRowResult {
	row: number
	ok: boolean
	id: number | null
	error: string | null
	/** Set when the row failed because a device type with this model already exists. */
	existing_device_type?: { id: number; model: string }
}

export interface ImportResponse {
	created: number
	failed: number
	rows: ImportRowResult[]
}

/** `GET /device-types/:id/yaml`: the type as importable YAML. */
export interface DeviceTypeYamlExport {
	yaml: string
}

/** Device-type fields a YAML update can change, with their value as text. */
export const DEVICE_TYPE_UPDATE_FIELDS = [
	'manufacturer',
	'model',
	'u_height',
	'is_full_depth',
	'default_device_role',
	'part_number',
	'spec_url',
	'eol_date',
	'description',
	'comments',
] as const

/** Port fields a YAML update can change, beyond the ones a device syncs. */
export const DEVICE_TYPE_UPDATE_PORT_FIELDS = [
	...TEMPLATE_SYNC_FIELDS,
	'face',
	'maximum_draw',
	'poe_mode',
	'poe_type',
] as const

export interface DeviceTypeUpdateChange {
	field:
		| (typeof DEVICE_TYPE_UPDATE_FIELDS)[number]
		| (typeof DEVICE_TYPE_UPDATE_PORT_FIELDS)[number]
	from: string | null
	to: string | null
}

/** A port of a device type in an update preview; ports match on side and name. */
export interface DeviceTypeUpdatePort {
	name: string
	side: PortSide | null
	kind: string
}

/**
 * `POST /device-types/:id/update-preview`: what applying the YAML would change.
 * `device_count` devices use the type; port changes reach them by template sync.
 */
export interface DeviceTypeUpdatePreview {
	revision: string
	fields: DeviceTypeUpdateChange[]
	added_ports: DeviceTypeUpdatePort[]
	removed_ports: DeviceTypeUpdatePort[]
	changed_ports: (DeviceTypeUpdatePort & { changes: DeviceTypeUpdateChange[] })[]
	unchanged_ports: number
	device_count: number
}

// ---------------------------------------------------------------------------
// Integrations (TANSS, Octoja, UniFi, Microsoft 365). External systems are
// read-only sources: conex links its tenants/devices/employees to external
// objects and reports where the data disagrees. See `docs/integrations.md`.
// ---------------------------------------------------------------------------

export const INTEGRATION_PROVIDERS = ['tanss', 'octoja', 'unifi', 'm365'] as const

/** `[integrations] mode`: `offline` blocks every integration, `mock` serves captured snapshots. */
export const INTEGRATION_MODES = ['live', 'offline', 'mock'] as const
export type IntegrationMode = (typeof INTEGRATION_MODES)[number]

/** `GET /integrations/mode`: how the server reaches external systems. */
export interface IntegrationModeJson {
	mode: IntegrationMode
}

export const IntegrationProviderSchema = v.picklist(INTEGRATION_PROVIDERS)

export type IntegrationProvider = v.InferOutput<typeof IntegrationProviderSchema>

/** Whether the provider needs an ERP API token besides username and password (TANSS only). */
export function providerNeedsErpToken(provider: IntegrationProvider): boolean {
	return provider === 'tanss'
}

/**
 * Whether the provider logs in with a username (TANSS) or mail address
 * (Octoja). UniFi authenticates with an API key alone: it is stored as the
 * password and the username stays empty.
 */
export function providerNeedsUsername(provider: IntegrationProvider): boolean {
	return provider !== 'unifi' && provider !== 'm365'
}

/** Default base URL prefilled in the setup form; `null` when there is none (self-hosted). */
export function providerDefaultBaseUrl(provider: IntegrationProvider): string | null {
	return provider === 'unifi' ? 'https://api.ui.com' : null
}

const BaseUrlSchema = v.pipe(
	v.string(),
	v.trim(),
	v.url('Must be a URL'),
	v.regex(/^https?:\/\//, 'Must start with http:// or https://'),
	v.maxLength(500),
	v.transform((raw) => raw.replace(/\/+$/, '')),
)

/** Empty for providers without a username (UniFi); required otherwise, checked by the server. */
const IntegrationUsernameSchema = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), '')

const SecretSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(4096))

/**
 * Secret fields per provider: write-only, encrypted at rest and only
 * reported back as set / not set (`IntegrationJson.secrets_set`). Every
 * other body field except `provider` and `enabled` is plain configuration:
 * `base_url` and `username` have columns, the rest is stored in `settings`.
 */
export interface IntegrationSecretFields {
	tanss: readonly ['password', 'erp_token']
	octoja: readonly ['password']
	unifi: readonly ['password']
	m365: readonly ['client_secret']
}

export const INTEGRATION_SECRET_FIELDS: IntegrationSecretFields = {
	tanss: ['password', 'erp_token'],
	octoja: ['password'],
	unifi: ['password'],
	m365: ['client_secret'],
}

/** Entra tenant id (a GUID). */
export const EntraTenantGuidSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'Must be a GUID'),
)

/** Entra tenant id or one of its domains (`contoso.onmicrosoft.com`). */
const EntraTenantSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.regex(
		/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|([a-z0-9-]+\.)+[a-z]{2,})$/,
		'Must be a tenant id or domain',
	),
	v.maxLength(253),
)

/** Application (client) id of the MSP's multi-tenant Entra app. */
const EntraClientIdSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'Must be a GUID'),
)

/** Expiry date of the client secret (`YYYY-MM-DD`); empty = unknown. */
const SecretExpirySchema = v.union([v.literal(''), CalendarDateSchema])

/**
 * Plain settings of the M365 integration (stored in `integrations.settings`).
 * `home_tenant` is the MSP's own tenant (id or domain), where "Test
 * connection" gets a token.
 */
export const M365SettingsSchema = v.object({
	client_id: EntraClientIdSchema,
	home_tenant: EntraTenantSchema,
	/** Only users with a license (skips shared/room mailboxes and service accounts). */
	licensed_only: v.optional(v.boolean(), true),
	secret_expires: v.optional(SecretExpirySchema, ''),
})

export type M365Settings = v.InferOutput<typeof M365SettingsSchema>

export type IntegrationSecretField<P extends IntegrationProvider = IntegrationProvider> =
	IntegrationSecretFields[P][number]

/**
 * Integration create body, one variant per provider. Saving logs in to the
 * external system first; the row is only stored when the credentials work.
 */
export const IntegrationCreateSchema = v.variant('provider', [
	v.strictObject({
		provider: v.literal('tanss'),
		base_url: BaseUrlSchema,
		username: IntegrationUsernameSchema,
		password: SecretSchema,
		erp_token: SecretSchema,
	}),
	v.strictObject({
		provider: v.literal('octoja'),
		base_url: BaseUrlSchema,
		username: IntegrationUsernameSchema,
		password: SecretSchema,
	}),
	v.strictObject({
		provider: v.literal('unifi'),
		base_url: BaseUrlSchema,
		username: IntegrationUsernameSchema,
		password: SecretSchema,
	}),
	v.strictObject({
		provider: v.literal('m365'),
		client_id: EntraClientIdSchema,
		home_tenant: EntraTenantSchema,
		licensed_only: v.optional(v.boolean(), true),
		secret_expires: v.optional(SecretExpirySchema, ''),
		client_secret: SecretSchema,
	}),
])

/**
 * Integration patch: omitted fields keep the stored values (secrets too).
 * `provider` selects the variant and must match the route.
 */
export const IntegrationUpdateSchema = v.variant('provider', [
	v.strictObject({
		provider: v.literal('tanss'),
		base_url: v.optional(BaseUrlSchema, undefined),
		username: v.optional(IntegrationUsernameSchema, undefined),
		password: v.optional(SecretSchema, undefined),
		erp_token: v.optional(SecretSchema, undefined),
		enabled: v.optional(v.boolean(), undefined),
	}),
	v.strictObject({
		provider: v.literal('octoja'),
		base_url: v.optional(BaseUrlSchema, undefined),
		username: v.optional(IntegrationUsernameSchema, undefined),
		password: v.optional(SecretSchema, undefined),
		enabled: v.optional(v.boolean(), undefined),
	}),
	v.strictObject({
		provider: v.literal('unifi'),
		base_url: v.optional(BaseUrlSchema, undefined),
		username: v.optional(IntegrationUsernameSchema, undefined),
		password: v.optional(SecretSchema, undefined),
		enabled: v.optional(v.boolean(), undefined),
	}),
	v.strictObject({
		provider: v.literal('m365'),
		client_id: v.optional(EntraClientIdSchema, undefined),
		home_tenant: v.optional(EntraTenantSchema, undefined),
		licensed_only: v.optional(v.boolean(), undefined),
		secret_expires: v.optional(SecretExpirySchema, undefined),
		client_secret: v.optional(SecretSchema, undefined),
		enabled: v.optional(v.boolean(), undefined),
	}),
])

/**
 * "Test connection" body: the unsaved form values. Missing secrets fall back
 * to the stored ones of an existing integration.
 */
export const IntegrationTestSchema = v.variant('provider', [
	v.strictObject({
		provider: v.literal('tanss'),
		base_url: BaseUrlSchema,
		username: IntegrationUsernameSchema,
		password: v.optional(SecretSchema, undefined),
		erp_token: v.optional(SecretSchema, undefined),
	}),
	v.strictObject({
		provider: v.literal('octoja'),
		base_url: BaseUrlSchema,
		username: IntegrationUsernameSchema,
		password: v.optional(SecretSchema, undefined),
	}),
	v.strictObject({
		provider: v.literal('unifi'),
		base_url: BaseUrlSchema,
		username: IntegrationUsernameSchema,
		password: v.optional(SecretSchema, undefined),
	}),
	v.strictObject({
		provider: v.literal('m365'),
		client_id: EntraClientIdSchema,
		home_tenant: EntraTenantSchema,
		licensed_only: v.optional(v.boolean(), undefined),
		secret_expires: v.optional(SecretExpirySchema, undefined),
		client_secret: v.optional(SecretSchema, undefined),
	}),
])

export type IntegrationCreate = v.InferOutput<typeof IntegrationCreateSchema>
export type IntegrationUpdate = v.InferOutput<typeof IntegrationUpdateSchema>
export type IntegrationTest = v.InferOutput<typeof IntegrationTestSchema>

export const IntegrationParamsSchema = v.object({ provider: IntegrationProviderSchema })

export const IntegrationEntityParamsSchema = v.object({
	provider: IntegrationProviderSchema,
	id: IdSchema,
})

/**
 * conex object an external object is linked to. External tenants link to a
 * `tenant` or, for providers whose `link_level` is `site` (UniFi consoles),
 * to a `site`.
 */
export const LinkEntityTypeSchema = v.picklist(['tenant', 'site', 'device', 'employee'])

export type LinkEntityType = v.InferOutput<typeof LinkEntityTypeSchema>

const ExternalIdSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))

/** Links a conex tenant/site/device/employee to an external object (replaces its old link). */
export const ExternalLinkCreateSchema = v.strictObject({
	entity_type: LinkEntityTypeSchema,
	entity_id: IdSchema,
	external_id: ExternalIdSchema,
})

/** Marks an external object as intentionally absent from conex. */
export const ExternalIgnoreSchema = v.strictObject({
	entity_type: LinkEntityTypeSchema,
	external_id: ExternalIdSchema,
})

/**
 * Marks a conex tenant, site, device or employee as intentionally absent from
 * the external system (suppresses its `tenant_unlinked` / `site_unlinked` /
 * `*_missing_in_external` finding). Stored
 * as an `ignored` link row keyed by the conex entity; see `ignoreLocal` in
 * `server/src/integrations/links.ts` for the synthetic `external_id`.
 */
export const ExternalIgnoreLocalSchema = v.strictObject({
	entity_type: LinkEntityTypeSchema,
	entity_id: IdSchema,
})

/**
 * Creates conex employees of a tenant from external employees of the
 * company linked to it (resolves `employee_missing_in_conex`) and links
 * each pair.
 */
export const ExternalEmployeeImportSchema = v.strictObject({
	tenant_id: IdSchema,
	external_ids: v.pipe(v.array(ExternalIdSchema), v.minLength(1), v.maxLength(1000)),
})

/**
 * Creates a conex device in the external system (resolves its
 * `device_missing_in_external` finding) and links the two.
 */
export const ExternalDeviceCreateSchema = v.strictObject({
	device_id: IdSchema,
})

/**
 * Creates a conex device of a tenant from an external device of an external
 * tenant linked to it (resolves `device_missing_in_conex`) and links the two.
 * Serial, asset tag and status come from the external device.
 */
export const ExternalDeviceImportSchema = v.strictObject({
	tenant_id: IdSchema,
	external_id: ExternalIdSchema,
	name: NameSchema,
	device_type_id: IdSchema,
	device_role_id: IdSchema,
})

/** Device fields whose conex value can overwrite the external one on a mismatch. */
export const EXTERNAL_PUSH_FIELDS = ['name', 'manufacturer', 'model'] as const

export type ExternalPushField = (typeof EXTERNAL_PUSH_FIELDS)[number]

/** Device fields whose external value can be taken into conex on a mismatch. */
export const EXTERNAL_PULL_FIELDS = ['serial'] as const

export type ExternalPullField = (typeof EXTERNAL_PULL_FIELDS)[number]

/** Writes one conex field of a linked device to the external system. */
export const ExternalDeviceUpdateSchema = v.strictObject({
	device_id: IdSchema,
	field: v.picklist(EXTERNAL_PUSH_FIELDS),
})

/** Employee fields whose conex value can overwrite the external one on a mismatch. */
export const EMPLOYEE_PUSH_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'mobile'] as const

export type EmployeePushField = (typeof EMPLOYEE_PUSH_FIELDS)[number]

/** Writes one conex field of a linked employee to the external system. */
export const ExternalEmployeeUpdateSchema = v.strictObject({
	employee_id: IdSchema,
	field: v.picklist(EMPLOYEE_PUSH_FIELDS),
})

/** Deactivates an external employee, whether or not they are linked to conex. */
export const ExternalEmployeeDeactivateSchema = v.strictObject({
	external_id: ExternalIdSchema,
})

export type ExternalEmployeeImport = v.InferOutput<typeof ExternalEmployeeImportSchema>
export type ExternalDeviceImport = v.InferOutput<typeof ExternalDeviceImportSchema>

export const IntegrationSyncQuerySchema = v.object({
	/** Sync only this tenant's company; omitted = all linked tenants. */
	tenant: OptionalIdEntry,
	/** Bypass the incremental cursor and fetch the complete external list. */
	clean: v.optional(v.literal('true'), undefined),
})

export const ExternalTenantQuerySchema = v.object({
	search: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200)), ''),
})

export const IntegrationReportQuerySchema = v.object({
	tenant: OptionalIdEntry,
	tenant_group: OptionalIdEntry,
})

/** Link board: tenants or sites (per `link_level`), or the devices/employees of one conex tenant. */
export const LinkBoardQuerySchema = v.object({
	entity_type: LinkEntityTypeSchema,
	/** Device/employee board only: the conex tenant whose objects are shown. */
	tenant: OptionalIdEntry,
})

/**
 * New ticket in the external system for a linked tenant (company), optionally
 * attached to one of its linked devices and reported by one of its linked
 * employees. The priority is set as the external tag of the same name
 * (TANSS); the form preselects the lowest one.
 */
export const TicketCreateSchema = v.strictObject({
	tenant_id: IdSchema,
	device_id: v.optional(IdSchema, undefined),
	employee_id: v.optional(IdSchema, undefined),
	priority_id: v.optional(IdSchema, undefined),
	title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
	content: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(10000)), ''),
})

export type TicketCreate = v.InferOutput<typeof TicketCreateSchema>

/** Created external ticket. */
export interface TicketCreated {
	id: number
}

/** Open tickets of one tenant; scoped users always get their own tenant. */
export const TicketListQuerySchema = v.object({
	tenant: OptionalIdEntry,
})

/** Open ticket in the external system (times in unix seconds). */
export interface ExternalTicketJson {
	id: number
	title: string
	/** Status name; null when the external system did not resolve it. */
	status: string | null
	created_at: number | null
	modified_at: number | null
	/** Names of the tags on the ticket. */
	tags: string[]
	/** Local priority whose label matches one of the tags; null when none does. */
	priority: { id: number; name: string; rank: number; color: string } | null
}

/**
 * Open tickets of a tenant, cached server-side for up to 30 minutes.
 * `linked` is false (and the list empty) without a company link.
 */
export interface TicketListJson {
	linked: boolean
	/** Base URL of the external system (no trailing slash); null when not linked. */
	base_url: string | null
	fetched_at: number | null
	tickets: ExternalTicketJson[]
}

export type SyncRunState = 'running' | 'ok' | 'error'

export interface SyncRunJson {
	id: number
	provider: IntegrationProvider
	tenant_id: number | null
	/** Unix seconds. */
	started_at: number
	finished_at: number | null
	state: SyncRunState
	error: string | null
	counts: { tenants: number; devices: number; employees: number; auto_linked: number }
}

/**
 * What a provider supports, so the client gates features on it instead of
 * on the provider id. Static per provider.
 */
export interface IntegrationCapabilities {
	/** Syncs employees (contacts / users); without them the report has no employee level. */
	employees: boolean
	/** Syncs devices; without them the report has no device level. */
	devices: boolean
	/** Opens and lists tickets, with priorities as ticket tags. */
	tickets: boolean
	/** Overwrites external employee fields with conex values and deactivates employees. */
	push: boolean
	/** Device fields whose conex value can overwrite the external one. */
	device_push: readonly ExternalPushField[]
	/**
	 * Device fields whose external value can be taken into conex; a value
	 * missing in conex is then reported as a mismatch too.
	 */
	device_pull: readonly ExternalPullField[]
	/** Creates conex devices in the external system. */
	create_device: boolean
	/** External tenants carry a customer number that is compared with the conex one. */
	customer_numbers: boolean
	/**
	 * conex object an external tenant links to, one each way: a tenant (TANSS
	 * company), or a site (UniFi console; a tenant then has one per site, and
	 * devices are compared per site instead of per tenant).
	 */
	link_level: 'tenant' | 'site'
}

/** Integration without secrets: only whether they are set. */
export interface IntegrationJson {
	id: number
	provider: IntegrationProvider
	/** Null for providers without a configurable server. */
	base_url: string | null
	/** Null for providers that do not log in with a user. */
	username: string | null
	/** Provider-specific plain settings. */
	settings: Record<string, unknown>
	/** Per secret field of the provider: whether a value is stored. */
	secrets_set: Record<string, boolean>
	capabilities: IntegrationCapabilities
	enabled: boolean
	created_at: number
	updated_at: number
	last_login_ok_at: number | null
	last_error: string | null
	last_sync: SyncRunJson | null
}

/** Normalized external tenant (TANSS company, UniFi console, Entra tenant). */
export interface ExternalTenantJson {
	external_id: string
	/** Customer number (TANSS); null for providers without one. */
	display_id: string | null
	name: string
	active: boolean
	/** Private person, not a business customer (never offered for linking). */
	private: boolean
	/** Headquarter company of a branch. */
	headquarter_id: string | null
	/**
	 * Verified mail domains (M365), compared with the tenant's primary mail
	 * address; absent for providers without them.
	 */
	domains?: string[]
}

/** External tenant plus the conex tenant or site (`link_level`) it is linked to (picker rows). */
export interface ExternalTenantListItem extends ExternalTenantJson {
	linked_entity_id: number | null
	ignored: boolean
}

/** Normalized external device (TANSS PC/server or periphery). */
export interface ExternalDeviceJson {
	/** Type-prefixed, e.g. `pc:123`. */
	external_id: string
	external_tenant_id: string
	kind: string
	name: string
	serial: string | null
	asset_tag: string | null
	manufacturer: string | null
	model: string | null
	macs: string[]
	ips: string[]
	active: boolean
}

/** Normalized external employee (TANSS contact person of a company). */
export interface ExternalEmployeeJson {
	external_id: string
	/** Preferred company, else the first assigned one; null when unassigned. */
	external_tenant_id: string | null
	/** Every company the employee is assigned to. */
	external_tenant_ids: string[]
	/** First + last name. */
	name: string
	first_name: string | null
	last_name: string
	salutation: EmployeeSalutation | null
	title: string | null
	email: string | null
	phone: string | null
	mobile: string | null
	active: boolean
}

export type ExternalLinkState = 'linked' | 'ignored'

export interface ExternalLinkJson {
	id: number
	provider: IntegrationProvider
	entity_type: LinkEntityType
	entity_id: number | null
	external_id: string
	external_tenant_id: string | null
	state: ExternalLinkState
	method: 'manual' | 'auto'
	created_by: number | null
	created_at: number
}

export const DEVICE_COMPARE_FIELDS = [
	'name',
	'serial',
	'asset_tag',
	'manufacturer',
	'model',
] as const

export type DeviceCompareField = (typeof DEVICE_COMPARE_FIELDS)[number]

export const EMPLOYEE_COMPARE_FIELDS = [
	'first_name',
	'last_name',
	'salutation',
	'title',
	'email',
	'phone',
	'mobile',
] as const

export type EmployeeCompareField = (typeof EMPLOYEE_COMPARE_FIELDS)[number]

export const FINDING_KINDS = [
	'tenant_unlinked',
	'site_unlinked',
	'tenant_missing_in_conex',
	'tenant_stale',
	'tenant_inactive',
	'tenant_customer_number_mismatch',
	'tenant_domain_unverified',
	'device_missing_in_conex',
	'device_missing_in_external',
	'device_suggestion',
	'device_stale',
	'device_mismatch',
	'employee_missing_in_conex',
	'employee_missing_in_external',
	'employee_suggestion',
	'employee_stale',
	'employee_mismatch',
	'employee_inactive_in_external',
	'priority_tag_missing',
] as const

export type FindingKind = (typeof FINDING_KINDS)[number]

/** One consistency finding. Unused fields are null. */
export interface IntegrationFinding {
	kind: FindingKind
	tenant_id: number | null
	tenant_name: string | null
	/** Site of site-level findings (`link_level: 'site'`) and their devices. */
	site_id: number | null
	site_name: string | null
	device_id: number | null
	device_name: string | null
	employee_id: number | null
	employee_name: string | null
	link_id: number | null
	external_id: string | null
	external_name: string | null
	external_tenant_id: string | null
	/**
	 * `tenant`/`status` only on `device_mismatch` and `employee_mismatch`
	 * (`site` instead of `tenant` for site-level providers); `priority` on
	 * `priority_tag_missing` (priority label in `local`).
	 */
	field:
		| DeviceCompareField
		| EmployeeCompareField
		| 'customer_number'
		| 'domain'
		| 'tenant'
		| 'site'
		| 'status'
		| 'priority'
		| null
	local: string | null
	/** On an employee suggestion, the external employee's active/inactive status. */
	remote: string | null
}

export interface IntegrationReport {
	provider: IntegrationProvider
	/** Finish time of the last successful sync (unix seconds), null = never. */
	synced_at: number | null
	findings: IntegrationFinding[]
}

/** Side-by-side value of one compared device or employee field. */
export interface FieldComparison {
	field: DeviceCompareField | EmployeeCompareField
	local: string | null
	remote: string | null
	equal: boolean
}

/** conex side of the link board. */
export interface LinkBoardLocal {
	id: number
	name: string
	/** Tenant group, site tenant, device manufacturer + model, or employee title + email. */
	detail: string | null
	serial: string | null
	active: boolean
	link_id: number | null
	external_id: string | null
	/** Name of the linked external object; null when it no longer exists. */
	external_name: string | null
	/** True when the conex object is ignored as missing in the external system. */
	ignored: boolean
	/** Unambiguous match candidate among the free external objects. */
	suggestion: { external_id: string; via: 'name' | 'serial' | 'asset_tag' | 'email' } | null
}

/** External side of the link board. */
export interface LinkBoardExternal {
	external_id: string
	name: string
	/** Customer number, device manufacturer + model, or employee title + email. */
	detail: string | null
	serial: string | null
	active: boolean
	link_id: number | null
	state: ExternalLinkState | null
	entity_id: number | null
	/** Name of the linked conex object (may lie outside the board). */
	entity_name: string | null
	/** Device boards: the conex device type matching its model (and manufacturer), if unique. */
	device_type_id?: number | null
}

/** Both sides of one link level, for side-by-side linking. */
export interface LinkBoard {
	provider: IntegrationProvider
	entity_type: LinkEntityType
	/** Finish time of the last successful sync (unix seconds), null = never. */
	synced_at: number | null
	/** Device/employee board: external tenants linked to the tenant (empty = not linked). */
	external_tenants: ExternalTenantJson[]
	local: LinkBoardLocal[]
	external: LinkBoardExternal[]
}

/** Integration card on the tenant detail page. */
export interface TenantIntegrationStatus {
	/**
	 * Linked external tenants: at most one, or one per site of the tenant for
	 * providers with `link_level: 'site'` (`site` set); `external` is null
	 * when it no longer exists.
	 */
	links: {
		link: ExternalLinkJson
		external: ExternalTenantJson | null
		site: { id: number; name: string } | null
	}[]
	finding_counts: Partial<Record<FindingKind, number>>
}

/** Integration card on the device detail page. */
export interface DeviceIntegrationStatus {
	link: ExternalLinkJson | null
	external: ExternalDeviceJson | null
	fields: FieldComparison[]
	/** External tenants linked to the device's tenant (to its site for `link_level: 'site'`). */
	external_tenants: ExternalTenantJson[]
	/** Unlinked, not ignored external devices of those tenants (link picker). */
	candidates: ExternalDeviceJson[]
}

/** Integration card on the employee detail page. */
export interface EmployeeIntegrationStatus {
	link: ExternalLinkJson | null
	external: ExternalEmployeeJson | null
	fields: FieldComparison[]
	/** External tenants linked to the employee's tenant. */
	external_tenants: ExternalTenantJson[]
	/** Unlinked, not ignored external employees of those tenants (link picker). */
	candidates: ExternalEmployeeJson[]
}

// ---------------------------------------------------------------------------
// Microsoft 365: customer Entra tenants that consented to the MSP's
// multi-tenant app. The app cannot ask Graph which tenants consented, so
// conex keeps the list (`m365_tenants`); it feeds the sync.
// ---------------------------------------------------------------------------

/** Consented customer tenant and the outcome of its last fetch. */
export interface M365TenantJson {
	ms_tenant_id: string
	display_name: string | null
	default_domain: string | null
	consented_at: number
	last_ok_at: number | null
	last_error: string | null
	/** conex tenant linked to it, null when none. */
	linked_tenant_id: number | null
}

/** Admin consent link for one conex tenant; `?tenant=` and the client's origin. */
export const M365ConsentLinkQuerySchema = v.object({
	tenant: IdSchema,
	/** `window.location.origin`; ignored when `frontendUrl` is configured. */
	origin: v.optional(v.pipe(v.string(), v.url(), v.maxLength(500)), undefined),
})

export interface M365ConsentLinkJson {
	url: string
	/** The redirect URI to register in the app (`…/api/integrations/m365/consent`). */
	redirect_uri: string
	/** Unix seconds; the link's signed state expires then. */
	expires_at: number
}

/**
 * Connects a conex tenant to an Entra tenant whose admin already consented
 * (another way than the consent link): proven by reading `/organization`.
 */
export const M365ConnectSchema = v.strictObject({
	tenant_id: IdSchema,
	ms_tenant: EntraTenantSchema,
})

export type M365Connect = v.InferOutput<typeof M365ConnectSchema>

export const M365TenantParamsSchema = v.object({ ms_tenant_id: EntraTenantGuidSchema })

/** Query Entra appends to the consent redirect (all optional, nothing trusted). */
export const M365ConsentCallbackQuerySchema = v.object({
	tenant: v.optional(v.pipe(v.string(), v.maxLength(253)), undefined),
	state: v.optional(v.pipe(v.string(), v.maxLength(500)), undefined),
	admin_consent: v.optional(v.pipe(v.string(), v.maxLength(10)), undefined),
	error: v.optional(v.pipe(v.string(), v.maxLength(200)), undefined),
	error_description: v.optional(v.pipe(v.string(), v.maxLength(2000)), undefined),
})

// ---------------------------------------------------------------------------
// Saved filters: named FilterTable filter sets, stored per table for all
// users. `values` maps filter keys (plus the quick search `q`) to a text or
// a list of selected options, as the table hands them out. `layout` names a
// saved layout of the same table applied with the filter; a name no saved
// layout has is ignored (filters saved before it existed have none).
// ---------------------------------------------------------------------------

const SavedFilterTableKeySchema = v.pipe(v.string(), v.regex(/^[a-z0-9_.-]{1,100}$/))

export const SavedFilterTableParamsSchema = v.object({
	table: SavedFilterTableKeySchema,
})

/** One saved filter by its table and 0-based position in that table's list. */
export const SavedFilterEntryParamsSchema = v.object({
	table: SavedFilterTableKeySchema,
	position: v.pipe(
		v.string(),
		v.regex(/^\d{1,3}$/),
		v.transform((raw) => Number(raw)),
	),
})

/** `?search=` matches the filter name; `?table=a,b` limits the tables. */
export const SavedFilterListQuerySchema = v.object({
	...ListQueryEntries,
	table: v.optional(
		v.pipe(CsvListSchema, v.array(SavedFilterTableKeySchema), v.transform(emptyAsUndefined)),
		undefined,
	),
})

export type SavedFilterListQuery = v.InferOutput<typeof SavedFilterListQuerySchema>

const SavedFilterValueSchema = v.union([
	v.pipe(v.string(), v.maxLength(500)),
	v.pipe(v.array(v.pipe(v.string(), v.maxLength(500))), v.maxLength(100)),
])

export const SavedFilterSchema = v.strictObject({
	name: NameSchema,
	values: v.record(v.pipe(v.string(), v.maxLength(100)), SavedFilterValueSchema),
	layout: v.optional(NameSchema),
})

/** Full list of a table's saved filters; a PUT replaces the stored list. */
export const SavedFilterListSchema = v.pipe(v.array(SavedFilterSchema), v.maxLength(100))

export type SavedFilterJson = v.InferOutput<typeof SavedFilterSchema>

/**
 * Replaces one saved filter. `current_name` is the name the client saw at
 * `position`: when the list changed meanwhile, the server answers 409 instead
 * of overwriting another filter.
 */
export const SavedFilterUpdateSchema = v.strictObject({
	current_name: NameSchema,
	filter: SavedFilterSchema,
})

export type SavedFilterUpdate = v.InferOutput<typeof SavedFilterUpdateSchema>

/** Delete guard, see {@link SavedFilterUpdateSchema}. */
export const SavedFilterDeleteQuerySchema = v.object({
	name: NameSchema,
})

/** The fields every saved-list overview entry shares (saved filters, layouts). */
export interface SavedListEntryBase {
	table: string
	/** 0-based position in the table's list (its tab or menu order). */
	position: number
	name: string
	/** Unix seconds of the table's last save. */
	updated_at: number
}

/** Overview page plus every table key that holds saved items (for the table filter). */
export interface SavedListPageJson<E extends SavedListEntryBase> {
	items: E[]
	total: number
	page: number
	limit: number
	tables: string[]
}

/** One saved filter of the overview across all tables. */
export interface SavedFilterEntryJson extends SavedListEntryBase {
	values: SavedFilterJson['values']
	layout?: string
}

export type SavedFilterPageJson = SavedListPageJson<SavedFilterEntryJson>

// ---------------------------------------------------------------------------
// Saved layouts: named DataTable column layouts (visible columns, order,
// pixel widths), stored per table for all users like the saved filters.
// The table key, entry and list query params are shared with them.
// ---------------------------------------------------------------------------

const ColumnKeySchema = v.pipe(v.string(), v.maxLength(100))

export const SavedLayoutSchema = v.strictObject({
	name: NameSchema,
	layout: v.strictObject({
		visibleColumns: v.pipe(v.array(ColumnKeySchema), v.maxLength(200)),
		columnOrder: v.pipe(v.array(ColumnKeySchema), v.maxLength(200)),
		columnWidths: v.optional(
			v.record(
				ColumnKeySchema,
				v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10000)),
			),
		),
	}),
})

/** Full list of a table's saved layouts; a PUT replaces the stored list. */
export const SavedLayoutListSchema = v.pipe(v.array(SavedLayoutSchema), v.maxLength(100))

export type SavedLayoutJson = v.InferOutput<typeof SavedLayoutSchema>

/** Replaces one saved layout, guarded like {@link SavedFilterUpdateSchema}. */
export const SavedLayoutUpdateSchema = v.strictObject({
	current_name: NameSchema,
	layout: SavedLayoutSchema,
})

export type SavedLayoutUpdate = v.InferOutput<typeof SavedLayoutUpdateSchema>

/** One saved layout of the overview across all tables. */
export interface SavedLayoutEntryJson extends SavedListEntryBase {
	layout: SavedLayoutJson['layout']
}

export type SavedLayoutPageJson = SavedListPageJson<SavedLayoutEntryJson>

// ---------------------------------------------------------------------------
// Calendar sync: TANSS appointments (Einsatzplanung) → Outlook calendars of
// the mapped technicians through Microsoft Graph. One direction only; all
// routes need `integrations.manage`. See `docs/src/integrations/calendar-sync.md`.
// ---------------------------------------------------------------------------

/** Entra tenant: directory id (GUID) or a verified domain. */
const MsTenantIdSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'Tenant ID is required'),
	v.maxLength(200),
	v.regex(/^[A-Za-z0-9.-]+$/, 'Must be a tenant id or domain'),
)

const MsClientIdSchema = v.pipe(
	v.string(),
	v.trim(),
	v.regex(
		/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
		'Must be an application (client) id',
	),
)

/** Mailbox user principal name (or primary SMTP address). */
const MailboxUpnSchema = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.maxLength(200),
	v.email('Must be an email address / UPN'),
)

export const CALENDAR_SYNC_MIN_INTERVAL = 1
export const CALENDAR_SYNC_MAX_INTERVAL = 1440

/**
 * Calendar sync settings. The client secret is write-only: omitted keeps
 * the stored one. Changed credentials are verified (token request) first.
 */
export const CalendarSyncConfigSchema = v.strictObject({
	ms_tenant_id: MsTenantIdSchema,
	client_id: MsClientIdSchema,
	client_secret: v.optional(SecretSchema, undefined),
	enabled: v.boolean(),
	interval_minutes: v.pipe(
		v.number(),
		v.integer(),
		v.minValue(CALENDAR_SYNC_MIN_INTERVAL),
		v.maxValue(CALENDAR_SYNC_MAX_INTERVAL),
	),
})

/**
 * "Test connection": the unsaved form values; a missing secret falls back
 * to the stored one. With `mailbox_upn` the app must also reach that
 * mailbox's calendar.
 */
export const CalendarSyncTestSchema = v.strictObject({
	ms_tenant_id: MsTenantIdSchema,
	client_id: MsClientIdSchema,
	client_secret: v.optional(SecretSchema, undefined),
	mailbox_upn: v.optional(MailboxUpnSchema, undefined),
})

/** Technician → mailbox mapping (`PUT /calendar-sync/mappings/:tanssEmployeeId`). */
export const CalendarMappingSchema = v.strictObject({
	mailbox_upn: MailboxUpnSchema,
	enabled: v.boolean(),
})

export const CalendarMappingParamsSchema = v.object({ tanssEmployeeId: IdSchema })

export type CalendarSyncConfig = v.InferOutput<typeof CalendarSyncConfigSchema>
export type CalendarSyncTest = v.InferOutput<typeof CalendarSyncTestSchema>
export type CalendarMapping = v.InferOutput<typeof CalendarMappingSchema>

export interface CalendarSyncRunCounts {
	created: number
	updated: number
	deleted: number
	failed: number
}

export interface CalendarSyncRunJson {
	id: number
	/** Unix seconds. */
	started_at: number
	finished_at: number | null
	state: SyncRunState
	error: string | null
	counts: CalendarSyncRunCounts
}

/** Settings without the secret: only whether it is set. */
export interface CalendarSyncConfigJson {
	/** False until the settings were saved once. */
	configured: boolean
	ms_tenant_id: string
	client_id: string
	has_secret: boolean
	enabled: boolean
	interval_minutes: number
	last_error: string | null
	updated_at: number | null
	last_run: CalendarSyncRunJson | null
}

export interface CalendarMappingJson {
	tanss_employee_id: number
	mailbox_upn: string
	enabled: boolean
	created_at: number
}

/** TANSS technician with its mapping and the suggested mailbox (TANSS email). */
export interface CalendarTechnicianJson {
	tanss_employee_id: number
	name: string
	email: string | null
	mapping: CalendarMappingJson | null
}

// ---------------------------------------------------------------------------
// AI assistant (`routes/ai.ts`)
// ---------------------------------------------------------------------------

/** Providers the server can be configured with (`[ai] provider`). */
export const AI_PROVIDERS = ['claude', 'opencode'] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

/** opencode model reference: `"<providerID>/<modelID>"` (the model id may contain slashes). */
export const OPENCODE_MODEL_PATTERN = /^[^/\s]+\/\S+$/

/** Longest single chat message, in characters. */
export const AI_MESSAGE_MAX_LENGTH = 20_000
/** Most messages one chat request may carry (history included). */
export const AI_CHAT_MAX_MESSAGES = 50

const AiChatMessageSchema = v.strictObject({
	role: v.picklist(['user', 'assistant']),
	text: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(AI_MESSAGE_MAX_LENGTH)),
})

/**
 * One assistant turn: the whole conversation so far, oldest first. The server
 * keeps no chat state; the client resends the history with each request.
 */
export const AiChatSchema = v.strictObject({
	messages: v.pipe(
		v.array(AiChatMessageSchema),
		v.minLength(1),
		v.maxLength(AI_CHAT_MAX_MESSAGES),
		v.check(
			(list) => list[0]?.role === 'user' && list[list.length - 1]?.role === 'user',
			'The conversation must start and end with a user message',
		),
	),
})

export type AiChat = v.InferOutput<typeof AiChatSchema>
export type AiChatMessage = AiChat['messages'][number]

/** `GET /ai/status`: whether the assistant can be offered. */
export interface AiStatusJson {
	/** An `[ai]` section is configured and integrations are not offline. */
	enabled: boolean
	/** Configured provider; `mock` while `[integrations] mode = "mock"`. */
	provider: AiProvider | 'mock' | null
	model: string | null
}

/** `POST /ai/chat` reply. */
export interface AiChatReplyJson {
	text: string
	provider: AiProvider | 'mock'
	/** Model that answered; with server-side fallback it may differ from the configured one. */
	model: string
	/** The reply hit the output token limit and is cut off. */
	truncated: boolean
}

// ---------------------------------------------------------------------------
// Global settings (`routes/global_settings.ts`)
// ---------------------------------------------------------------------------

const ClaudeModelSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(200),
	v.regex(/^\S+$/, 'The model id must not contain spaces'),
)

const OpencodeModelSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(200),
	v.regex(OPENCODE_MODEL_PATTERN, 'Expected "<provider>/<model>"'),
)

/**
 * `PATCH /global-settings`: only the given fields change. `null` clears a
 * setting, so the value from the server config applies again.
 */
export const GlobalSettingsUpdateSchema = v.strictObject({
	ai_claude_model: v.optional(v.nullable(ClaudeModelSchema), undefined),
	ai_opencode_model: v.optional(v.nullable(OpencodeModelSchema), undefined),
	/** Day of month the billing period ends (1–28); null = the last day. */
	billing_cutoff_day: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(28))),
		undefined,
	),
})

export type GlobalSettingsUpdate = v.InferOutput<typeof GlobalSettingsUpdateSchema>

/** `GET /global-settings`. */
export interface GlobalSettingsJson {
	/** Default Claude model; null = `[ai.claude] model` of the server config. */
	ai_claude_model: string | null
	/** Default opencode model; null = `[ai.opencode] model`, else opencode's own default. */
	ai_opencode_model: string | null
	/** Day of month the billing period ends; null = the last day. */
	billing_cutoff_day: number | null
	/** Server config values that apply while a setting is null. */
	config: {
		/** `[ai] provider`; null when the assistant is not configured. */
		ai_provider: AiProvider | null
		ai_claude_model: string | null
		ai_opencode_model: string | null
	}
	updated_at: number | null
}

/** `GET /global-settings/ai-models?provider=…`: models the provider offers. */
export const AiModelListQuerySchema = v.object({
	provider: v.picklist(AI_PROVIDERS),
})

export type AiModelListQuery = v.InferOutput<typeof AiModelListQuerySchema>

export interface AiModelJson {
	/** Value of the setting: a Claude model id, or `"<provider>/<model>"` for opencode. */
	id: string
	/** Display name reported by the provider. */
	name: string
}

// ---------------------------------------------------------------------------
// Billing: monthly lot counts of the managed bundles (`billing.manage`).
// A period (`YYYY-MM`) ends at the cutoff day (global setting) at midnight,
// Europe/Berlin; a snapshot then freezes the counts and the objects behind
// them. Drafts may be retaken and edited, final periods never change.
// ---------------------------------------------------------------------------

/** Billing period: a calendar month, `YYYY-MM`. */
export const BillingPeriodSchema = v.pipe(
	v.string(),
	v.regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM'),
)

export const BillingPeriodParamsSchema = v.object({ period: BillingPeriodSchema })

export const BILLING_PERIOD_STATES = ['draft', 'final'] as const

export type BillingPeriodState = (typeof BILLING_PERIOD_STATES)[number]

/** Kinds of objects behind a count. */
export const BILLING_ITEM_TYPES = ['device', 'vm', 'interface', 'm365_user'] as const

export type BillingItemType = (typeof BILLING_ITEM_TYPES)[number]

/**
 * Findings that are not billed:
 * - `not_contracted`: an object falls under a bundle its tenant has no contract for
 * - `backup_not_contracted`: backed up, but no contracted bundle bills backups
 * - `no_tenant`: a billable object (bundle or backed up) without tenant
 * - `hostless_vm`: VMs without host are not billed yet
 * - `m365_not_linked`: M365 users are billed, but the tenant has no linked M365 tenant
 * - `m365_stale`: the last successful M365 fetch is older than a week
 * - `m365_unlicensed`: the M365 integration also syncs users without a license
 * - `storage_missing`: no stored data entered for this or an earlier period
 */
export const BILLING_EXCEPTION_KINDS = [
	'not_contracted',
	'backup_not_contracted',
	'no_tenant',
	'hostless_vm',
	'm365_not_linked',
	'm365_stale',
	'm365_unlicensed',
	'storage_missing',
] as const

export type BillingExceptionKind = (typeof BILLING_EXCEPTION_KINDS)[number]

export interface BillingExceptionJson {
	kind: BillingExceptionKind
	tenant_id: number | null
	tenant_name: string | null
	bundle_id: number | null
	bundle_name: string | null
	item_type: BillingItemType | null
	/** Device / VM id the item links to; null for other items. */
	ref_id: number | null
	item_repr: string | null
}

/** One billed line: a metric of a contracted bundle for one tenant. */
export interface BillingCountJson {
	tenant_id: number
	tenant_name: string
	customer_number: string | null
	bundle_id: number
	bundle_name: string
	service_level_name: string
	metric: BillingMetric
	/** Counted objects, or GB for `storage`. */
	quantity: number
	lots: number
	/** Lots of the previous snapshot; null when it has no such line. */
	previous_lots: number | null
	/** `storage`: the GB value is carried over from an earlier period. */
	carried: boolean
}

export interface BillingPeriodJson {
	period: string
	state: BillingPeriodState
	cutoff_at: number
	taken_at: number
	/** Null when the snapshot was taken automatically. */
	taken_by: string | null
	finalized_at: number | null
	finalized_by: string | null
}

/** A bundle as a column group of the report: its metrics in display order. */
export interface BillingBundleJson {
	id: number
	name: string
	metrics: BillingMetricConfig[]
}

/** `GET /billing/periods/:period`. */
export interface BillingReportJson {
	period: string
	cutoff_at: number
	/** Null while the period is not stored (live counts). */
	snapshot: BillingPeriodJson | null
	/** Stored period the changes compare against. */
	previous_period: string | null
	bundles: BillingBundleJson[]
	counts: BillingCountJson[]
	exceptions: BillingExceptionJson[]
	added: number
	removed: number
}

/** `GET /billing`: stored periods and where the calendar stands. */
export interface BillingOverviewJson {
	/** Newest first. */
	periods: BillingPeriodJson[]
	/** Period running now (live counts). */
	current_period: string
	/** Latest period whose cutoff has passed: the one to snapshot. */
	due_period: string
	cutoff_day: number | null
}

export const BillingItemsQuerySchema = v.object({
	tenant: IdSchema,
	bundle: IdSchema,
	metric: BillingMetricSchema,
})

export type BillingItemsQuery = v.InferOutput<typeof BillingItemsQuerySchema>

/** An object behind a count, with its change against the previous snapshot. */
export interface BillingItemJson {
	tenant_id: number
	tenant_name: string
	bundle_id: number
	bundle_name: string
	metric: BillingMetric
	item_type: BillingItemType
	item_id: string
	ref_id: number | null
	item_repr: string
	detail: string | null
	change: 'added' | 'removed' | null
}

/** `PUT /billing/periods/:period/storage`: stored data of one contract; null clears it. */
export const BillingStorageInputSchema = v.strictObject({
	tenant_id: IdSchema,
	bundle_id: IdSchema,
	gb: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000_000))),
})

export type BillingStorageInput = v.InferOutput<typeof BillingStorageInputSchema>
