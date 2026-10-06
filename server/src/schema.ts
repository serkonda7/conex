import { sql } from 'drizzle-orm'
import {
	type AnyPgColumn,
	bigint,
	customType,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
	DEVICE_ROLE_ICONS,
	EMPLOYEE_SALUTATIONS,
	type EmployeeEmail,
	type EmployeePhone,
	LOCATION_TYPES,
} from 'shared/src/schemas'

// P0 minimal schema: auth only. Domain tables (tenants, sites, racks,
// devices, cables) are added in P1-P5.
//
// Ids are Postgres identity integers (human readable in URLs and UIs).
// Flags (`is_full_depth`, `connected`, ...) are 0/1 integers.
// Session ids and auth-state values stay opaque random strings: they are
// credentials, not entity references.
// Roles bundle permissions (`shared/src/schemas.ts` `PERMISSIONS`); every
// user carries exactly one. Permission strings are service-enforced (no DB
// enum, writes go through `PermissionSchema`; unknown strings are ignored
// on load). Role delete is blocked while users reference it (service layer
// in `db/roles.ts`), so the users FK carries no cascade.
export const roles = pgTable('roles', {
	id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
	name: text('name').notNull().unique(),
	description: text('description'),
})

export const role_permissions = pgTable(
	'role_permissions',
	{
		role_id: integer('role_id')
			.notNull()
			.references(() => roles.id, { onDelete: 'cascade' }),
		permission: text('permission').notNull(),
	},
	(table) => [primaryKey({ columns: [table.role_id, table.permission] })],
)

export const users = pgTable('users', {
	id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
	username: text('username').notNull().unique(),
	password_hash: text('password_hash'),
	provider: text('provider').notNull().default('local'),
	provider_id: text('provider_id').unique(),
	// Assigned role (the first-run setup account gets a role holding every
	// permission).
	role_id: integer('role_id')
		.notNull()
		.references(() => roles.id),
	// Tenant scope (`NULL` = global, all tenants). Always `NULL` for users
	// whose role grants `users.manage`. Delete-blocked while referenced
	// (service layer in `db/tenancy.ts`), so the FK carries no cascade.
	tenant_id: integer('tenant_id').references(() => tenants.id),
})

export const sessions = pgTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		created_at: bigint('created_at', { mode: 'number' }).notNull(),
		last_seen_at: bigint('last_seen_at', { mode: 'number' }).notNull(),
		expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
	},
	(table) => [index('sessions_expires_at_idx').on(table.expires_at)],
)

export const auth_states = pgTable(
	'auth_states',
	{
		state: text('state').primaryKey(),
		verifier: text('verifier').notNull(),
		expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
	},
	(table) => [index('auth_states_expires_at_idx').on(table.expires_at)],
)

// Security audit trail (admin-only view). `event` is service-enforced
// (`AuditEventSchema`). `username` keeps the name as typed, so failed
// attempts against unknown accounts stay visible; `user_id` is set only
// when it resolved to an account and survives its deletion as NULL.
// `ip` is the socket peer; `forwarded_for` the raw, client-controlled
// `X-Forwarded-For` header, kept separately so a spoofed header never
// replaces the address the connection actually came from.
export const audit_log = pgTable(
	'audit_log',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		created_at: bigint('created_at', { mode: 'number' }).notNull(),
		event: text('event').notNull(),
		username: text('username').notNull(),
		user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
		ip: text('ip').notNull(),
		forwarded_for: text('forwarded_for'),
		user_agent: text('user_agent'),
	},
	(table) => [index('audit_log_created_at_idx').on(table.created_at)],
)

// ---------------------------------------------------------------------------
// P1: tenants / sites / locations. Tenants are documentation labels only —
// no row-level isolation; grouping is by nullable FK, delete-blocked when
// children exist (enforced in the service layer, not by FK cascade).
// ---------------------------------------------------------------------------

// Tenant groups are flat (no nesting) and own no inventory: they only
// bundle tenants so several can be selected at once. A tenant sits in at
// most one group; group delete is blocked while tenants reference it.
export const tenant_groups = pgTable(
	'tenant_groups',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		description: text('description'),
		comments: text('comments'),
	},
	(table) => [index('tenant_groups_name_idx').on(table.name)],
)

export const tenants = pgTable(
	'tenants',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		tenant_group_id: integer('tenant_group_id').references(() => tenant_groups.id),
		name: text('name').notNull(),
		customer_number: text('customer_number').unique(),
		description: text('description'),
		comments: text('comments'),
	},
	(table) => [
		index('tenants_name_idx').on(table.name),
		index('tenants_tenant_group_id_idx').on(table.tenant_group_id),
	],
)

// Site groups are flat (no nesting): a named bundle of sites. Slug is
// globally unique, like tenant groups.
export const site_groups = pgTable(
	'site_groups',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		description: text('description'),
		comments: text('comments'),
	},
	(table) => [
		index('site_groups_tenant_id_idx').on(table.tenant_id),
		index('site_groups_name_idx').on(table.name),
	],
)

export const sites = pgTable(
	'sites',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		site_group_id: integer('site_group_id').references(() => site_groups.id),
		name: text('name').notNull(),
		description: text('description'),
		comments: text('comments'),
		physical_address: text('physical_address'),
		shipping_address: text('shipping_address'),
	},
	(table) => [
		index('sites_tenant_id_idx').on(table.tenant_id),
		index('sites_site_group_id_idx').on(table.site_group_id),
		index('sites_name_idx').on(table.name),
	],
)

export const locations = pgTable(
	'locations',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		site_id: integer('site_id')
			.notNull()
			.references(() => sites.id),
		parent_id: integer('parent_id').references((): AnyPgColumn => locations.id),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		name: text('name').notNull(),
		// Slug is unique per parent (service-enforced; Postgres treats NULL
		// parents as distinct so a composite unique index cannot cover roots).
		slug: text('slug').notNull(),
		type: text('type', { enum: LOCATION_TYPES }).notNull().default('other'),
		description: text('description'),
	},
	(table) => [
		index('locations_site_id_idx').on(table.site_id),
		index('locations_parent_id_idx').on(table.parent_id),
		uniqueIndex('locations_sibling_slug_idx').on(table.site_id, table.parent_id, table.slug),
	],
)

/**
 * `jsonb` that hands values to the driver as-is. Drizzle's own `jsonb`
 * stringifies first, and Bun's SQL driver then stores that string as a JSON
 * string instead of an object.
 */
const jsonb = customType<{ data: unknown; driverData: unknown }>({
	dataType: () => 'jsonb',
	toDriver: (value: unknown): unknown => value,
})

// Employees: contact persons of a tenant (NetBox-style contacts). Every
// employee belongs to exactly one tenant; tenant delete is blocked while
// employees reference it (service layer), so the FK carries no cascade.
// `active` is 0/1 like the other flags; inactive employees stay listed but
// are never reported as missing in an external system. `name` is generated
// from first + last name, so lists, search and the changelog treat employees
// like every other named row.
export const employees = pgTable(
	'employees',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		tenant_id: integer('tenant_id')
			.notNull()
			.references(() => tenants.id),
		first_name: text('first_name'),
		last_name: text('last_name').notNull(),
		name: text('name')
			.notNull()
			.generatedAlwaysAs(sql`btrim(coalesce(first_name, '') || ' ' || last_name)`),
		// `mr` (Herr) / `ms` (Frau); null when unknown.
		salutation: text('salutation', { enum: EMPLOYEE_SALUTATIONS }),
		// Job title / function (`Managing director`, …).
		title: text('title'),
		// Mail addresses (first = primary) and phone numbers, in display order.
		emails: jsonb('emails').$type<EmployeeEmail[]>().notNull().default(sql`'[]'::jsonb`),
		phones: jsonb('phones').$type<EmployeePhone[]>().notNull().default(sql`'[]'::jsonb`),
		active: integer('active').notNull().default(1),
		description: text('description'),
		comments: text('comments'),
	},
	(table) => [
		index('employees_tenant_id_idx').on(table.tenant_id),
		index('employees_name_idx').on(table.name),
	],
)

// ---------------------------------------------------------------------------
// P2: racks. Occupancy is enforced in the service layer so the math stays
// unit-testable without a database.
// ---------------------------------------------------------------------------

export const racks = pgTable(
	'racks',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		site_id: integer('site_id')
			.notNull()
			.references(() => sites.id),
		location_id: integer('location_id').references(() => locations.id),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		rack_type_id: integer('rack_type_id').references(() => device_types.id),
		name: text('name').notNull(),
		description: text('description'),
	},
	(table) => [
		index('racks_site_id_idx').on(table.site_id),
		index('racks_location_id_idx').on(table.location_id),
		index('racks_tenant_id_idx').on(table.tenant_id),
		index('racks_name_idx').on(table.name),
	],
)

// ---------------------------------------------------------------------------
// P3: manufacturers / device templates. A device type belongs to one
// manufacturer; its interface stubs (`{prefix, count}`) expand into concrete
// interface names (`prefix1..prefix{count}`) when a device is instantiated
// in P4. Deletes are blocked while dependents exist (service layer), so FKs
// carry no cascade.
// ---------------------------------------------------------------------------

export const manufacturers = pgTable(
	'manufacturers',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		name: text('name').notNull().unique(),
		slug: text('slug').notNull().unique(),
		description: text('description'),
	},
	(table) => [index('manufacturers_name_idx').on(table.name)],
)

export const device_types = pgTable(
	'device_types',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		manufacturer_id: integer('manufacturer_id')
			.notNull()
			.references(() => manufacturers.id),
		model: text('model').notNull(),
		// Rack units consumed on mount (at least 1 U). Shelves are a
		// separate table and never device types.
		u_height: integer('u_height').notNull().default(1),
		// NetBox `is_full_depth`: false = half-depth.
		is_full_depth: integer('is_full_depth').notNull().default(1),
		// Rack-template dimensions. Null keeps existing non-rack templates valid.
		form_factor: text('form_factor'),
		width: integer('width'),
		description: text('description'),
		comments: text('comments'),
	},
	(table) => [
		index('device_types_manufacturer_id_idx').on(table.manufacturer_id),
		index('device_types_model_idx').on(table.model),
	],
)

export const device_type_interfaces = pgTable(
	'device_type_interfaces',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		device_type_id: integer('device_type_id')
			.notNull()
			.references(() => device_types.id),
		prefix: text('prefix').notNull(),
		count: integer('count').notNull().default(1),
		kind: text('kind').notNull().default('ethernet'),
		label: text('label'),
		description: text('description'),
	},
	(table) => [
		index('device_type_interfaces_type_id_idx').on(table.device_type_id),
		uniqueIndex('device_type_interfaces_prefix_kind_idx').on(
			table.device_type_id,
			table.prefix,
			table.kind,
		),
	],
)

// ---------------------------------------------------------------------------
// P3b: device roles (NetBox-style functional roles: `Server`, `Switch`, …).
// Shared catalog data (no tenant column): every device carries exactly one;
// role delete is blocked while devices reference it (service layer), so the
// FK carries no cascade.
// ---------------------------------------------------------------------------

export const device_roles = pgTable(
	'device_roles',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		name: text('name').notNull().unique(),
		description: text('description'),
		icon: text('icon', { enum: DEVICE_ROLE_ICONS }),
		// Built-in roles (`DEVICE_ROLE_KEYS`) carry their key; they are seeded
		// by migration and can be neither renamed nor deleted.
		key: text('key').unique(),
	},
	(table) => [index('device_roles_name_idx').on(table.name)],
)

// ---------------------------------------------------------------------------
// P4: devices / interfaces. Placement is exactly one of:
// | unracked           | rack null | position null | any u_height |
// | rack-assigned only | rack set  | position null | any          |
// | U-mounted          | rack set  | position set  | >= 1         |
// | on a shelf         | rack set  | position null | shelf set    |
// Shelves are a separate table (`shelves`) and compete for U space:
// a device mount overlapping a shelf's blocked span is rejected (service
// layer), and vice versa. Devices placed on a shelf (`shelf_id`) consume no
// U of their own; their rack is always the shelf's rack. Interface rows are
// expanded from template stubs at create time; P5 cables flip `connected`.
// Deletes of racks/device-types are blocked while devices reference them
// (service layer); device delete removes its interfaces in the same
// transaction.
// ---------------------------------------------------------------------------

export const devices = pgTable(
	'devices',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		device_type_id: integer('device_type_id')
			.notNull()
			.references(() => device_types.id),
		// NetBox-style functional role (`Server`, `Switch`, …). Required:
		// every device carries exactly one. Delete-blocked while referenced
		// (service layer in `db/device_roles.ts`), so the FK carries no cascade.
		device_role_id: integer('device_role_id')
			.notNull()
			.references(() => device_roles.id),
		site_id: integer('site_id').references(() => sites.id),
		location_id: integer('location_id').references(() => locations.id),
		rack_id: integer('rack_id').references(() => racks.id),
		// Rack face the device is mounted on (`front`/`rear`); only
		// meaningful for rack-mounted devices, otherwise null.
		face: text('face'),
		// Bottom-U, 1-based. Occupies position_u..position_u+u_height-1 where
		// the height comes from the device-type template.
		position_u: integer('position_u'),
		// Shelf the device sits on (never U-mounted at the same time).
		shelf_id: integer('shelf_id').references((): AnyPgColumn => shelves.id),
		status: text('status').notNull().default('active'),
		name: text('name').notNull(),
		serial: text('serial'),
		asset_tag: text('asset_tag').unique(),
		device_id: text('device_id').unique(),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		description: text('description'),
	},
	(table) => [
		index('devices_type_id_idx').on(table.device_type_id),
		index('devices_device_role_id_idx').on(table.device_role_id),
		index('devices_site_id_idx').on(table.site_id),
		index('devices_rack_id_idx').on(table.rack_id),
		index('devices_shelf_id_idx').on(table.shelf_id),
		index('devices_tenant_id_idx').on(table.tenant_id),
		index('devices_status_idx').on(table.status),
		index('devices_name_idx').on(table.name),
	],
)

// ---------------------------------------------------------------------------
// Shelves: rack fixtures, fully separate from devices. A shelf mounts at
// `position_u` with `mount_height` U of hardware plus `reserved_height` U of
// clearance directly above the mount. The mount span blocks device mounts
// unless `mount_usable` is set; the reserved span always blocks. Face and
// full-depth behave like device mounts (half-depth shelves on opposite
// faces may share U). Tenant scope is inherited from the rack.
// ---------------------------------------------------------------------------

export const shelves = pgTable(
	'shelves',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		rack_id: integer('rack_id')
			.notNull()
			.references(() => racks.id),
		name: text('name'),
		// Rack face the shelf is mounted on (`front`/`rear`); null occupies
		// both faces.
		face: text('face'),
		// Bottom-U of the mount hardware, 1-based.
		position_u: integer('position_u').notNull(),
		// U height of the mount hardware itself (>= 1).
		mount_height: integer('mount_height').notNull().default(1),
		// When set, the mount span stays usable for device mounts; only the
		// reserved span blocks.
		mount_usable: integer('mount_usable').notNull().default(0),
		// Extra U reserved above the mount (always blocks device mounts).
		reserved_height: integer('reserved_height').notNull().default(0),
		// NetBox `is_full_depth`: false = half-depth.
		is_full_depth: integer('is_full_depth').notNull().default(1),
		description: text('description'),
	},
	(table) => [
		index('shelves_rack_id_idx').on(table.rack_id),
		index('shelves_name_idx').on(table.name),
	],
)

export const interfaces = pgTable(
	'interfaces',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		device_id: integer('device_id')
			.notNull()
			.references(() => devices.id),
		name: text('name').notNull(),
		kind: text('kind').notNull().default('ethernet'),
		connected: integer('connected').notNull().default(0),
		enabled: integer('enabled').notNull().default(1),
		description: text('description'),
	},
	(table) => [
		index('interfaces_device_id_idx').on(table.device_id),
		uniqueIndex('interfaces_device_name_idx').on(table.device_id, table.name),
	],
)

// ---------------------------------------------------------------------------
// P5: cables (L1). A cable links exactly two distinct interfaces; each
// interface appears on at most one cable (unique on both ends, enforced here
// and in the service layer). `connected` on both interfaces flips true on
// connect and back to false on cable delete; it is never edited directly.
// Same-device links are allowed when the interfaces differ (v1); only the
// same interface twice is rejected.
// ---------------------------------------------------------------------------

export const cables = pgTable(
	'cables',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		a_interface_id: integer('a_interface_id')
			.notNull()
			.unique()
			.references(() => interfaces.id),
		b_interface_id: integer('b_interface_id')
			.notNull()
			.unique()
			.references(() => interfaces.id),
		status: text('status').notNull().default('connected'),
		kind: text('kind'),
		label: text('label'),
		description: text('description'),
	},
	(table) => [
		index('cables_a_interface_id_idx').on(table.a_interface_id),
		index('cables_b_interface_id_idx').on(table.b_interface_id),
		index('cables_status_idx').on(table.status),
	],
)

// ---------------------------------------------------------------------------
// Integrations: read-only links to external systems (TANSS; UniFi and
// servereye later). One row per provider in `integrations`; secrets are
// AES-GCM encrypted with a key derived from `auth.appKey` (`keys.ts`) and
// never leave the server. `external_links` maps conex tenants/devices to
// external ids for every provider; `entity_id` is polymorphic (no FK), so
// tenant/device/employee deletes remove their links in the service layer.
// `external_objects` is the last fetched snapshot the report runs against.
// ---------------------------------------------------------------------------

export const integrations = pgTable('integrations', {
	id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
	provider: text('provider').notNull().unique(),
	base_url: text('base_url').notNull(),
	username: text('username').notNull(),
	// `v1.<iv>.<ciphertext+tag>` (base64) of the JSON secrets object.
	secrets: text('secrets').notNull(),
	enabled: integer('enabled').notNull().default(1),
	created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
	created_at: bigint('created_at', { mode: 'number' }).notNull(),
	updated_at: bigint('updated_at', { mode: 'number' }).notNull(),
	last_login_ok_at: bigint('last_login_ok_at', { mode: 'number' }),
	last_error: text('last_error'),
})

export const external_links = pgTable(
	'external_links',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		provider: text('provider').notNull(),
		// `tenant` | `device` | `employee` (service-enforced).
		entity_type: text('entity_type').notNull(),
		// conex id; NULL when `state = 'ignored'`.
		entity_id: integer('entity_id'),
		external_id: text('external_id').notNull(),
		external_tenant_id: text('external_tenant_id'),
		// `linked` | `ignored`; `method` is `manual` | `auto`.
		state: text('state').notNull().default('linked'),
		method: text('method').notNull().default('manual'),
		created_by: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
		created_at: bigint('created_at', { mode: 'number' }).notNull(),
	},
	(table) => [
		uniqueIndex('external_links_external_idx').on(
			table.provider,
			table.entity_type,
			table.external_id,
		),
		index('external_links_entity_idx').on(table.entity_type, table.entity_id),
	],
)

export const external_objects = pgTable(
	'external_objects',
	{
		provider: text('provider').notNull(),
		// `tenant` | `device` | `employee`.
		object_type: text('object_type').notNull(),
		external_id: text('external_id').notNull(),
		external_tenant_id: text('external_tenant_id'),
		// Normalized record (`ExternalTenantJson` / `ExternalDeviceJson` /
		// `ExternalEmployeeJson`).
		data: jsonb('data').notNull(),
		fetched_at: bigint('fetched_at', { mode: 'number' }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.provider, table.object_type, table.external_id] }),
		index('external_objects_tenant_idx').on(
			table.provider,
			table.object_type,
			table.external_tenant_id,
		),
	],
)

export const sync_runs = pgTable(
	'sync_runs',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		provider: text('provider').notNull(),
		// NULL = all linked tenants.
		tenant_id: integer('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
		started_at: bigint('started_at', { mode: 'number' }).notNull(),
		finished_at: bigint('finished_at', { mode: 'number' }),
		// `running` | `ok` | `error`.
		state: text('state').notNull(),
		error: text('error'),
		counts: jsonb('counts'),
	},
	(table) => [index('sync_runs_provider_idx').on(table.provider, table.started_at)],
)

// ---------------------------------------------------------------------------
// Changelog (NetBox-style): one row per create/update/delete of an
// inventory object, written by the service layer. `object_type` and
// `action` are service-enforced (`ChangeObjectTypeSchema`,
// `ChangeActionSchema`); `object_id` is polymorphic (no FK) and the
// snapshots outlive the object. `username` keeps the actor's name so the
// row stays readable after the user is deleted; both are empty/NULL for
// changes made without a signed-in user. `request_id` groups the changes
// of one request. `tenant_id` is the tenant the object belonged to (after
// the change, or before a delete) and decides which tenant-scoped users see
// the row; NULL for catalog data and cables spanning tenants. No FK: a
// tenant's own delete is recorded after the row is gone.
// ---------------------------------------------------------------------------

export const object_changes = pgTable(
	'object_changes',
	{
		id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
		created_at: bigint('created_at', { mode: 'number' }).notNull(),
		user_id: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
		username: text('username').notNull(),
		request_id: text('request_id'),
		action: text('action').notNull(),
		object_type: text('object_type').notNull(),
		object_id: integer('object_id').notNull(),
		object_repr: text('object_repr').notNull(),
		tenant_id: integer('tenant_id'),
		prechange_data: jsonb('prechange_data'),
		postchange_data: jsonb('postchange_data'),
	},
	(table) => [
		index('object_changes_created_at_idx').on(table.created_at),
		index('object_changes_object_idx').on(table.object_type, table.object_id),
		index('object_changes_tenant_id_idx').on(table.tenant_id),
	],
)
