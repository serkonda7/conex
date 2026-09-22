import {
	type AnySQLiteColumn,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// P0 minimal schema: auth only. Domain tables (tenants, sites, racks,
// devices, cables) are added in P1-P5.
//
// Ids are SQLite autoincrement integers (human readable in URLs and UIs).
// Session ids and auth-state values stay opaque random strings: they are
// credentials, not entity references.
export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	password_hash: text('password_hash'),
	provider: text('provider').notNull().default('local'),
	provider_id: text('provider_id').unique(),
	// RBAC role (`admin` | `editor` | `viewer`, default `viewer`; the
	// first-run setup account is created as `admin`). Service-enforced enum:
	// SQLite has no native enum, so writes go through `RoleSchema`.
	role: text('role').notNull().default('viewer'),
	// Tenant scope for editors/viewers (`NULL` = global, all tenants).
	// Admins ignore this column. Delete-blocked while referenced (service
	// layer in `db/tenancy.ts`), so the FK carries no cascade.
	tenant_id: integer('tenant_id').references(() => tenants.id),
})

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		user_id: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		created_at: integer('created_at').notNull(),
		last_seen_at: integer('last_seen_at').notNull(),
		expires_at: integer('expires_at').notNull(),
	},
	(table) => [index('sessions_expires_at_idx').on(table.expires_at)],
)

export const auth_states = sqliteTable(
	'auth_states',
	{
		state: text('state').primaryKey(),
		verifier: text('verifier').notNull(),
		expires_at: integer('expires_at').notNull(),
	},
	(table) => [index('auth_states_expires_at_idx').on(table.expires_at)],
)

// ---------------------------------------------------------------------------
// P1: tenants / sites / locations. Tenants are documentation labels only —
// no row-level isolation; grouping is by nullable FK, delete-blocked when
// children exist (enforced in the service layer, not by FK cascade).
// ---------------------------------------------------------------------------

export const tenants = sqliteTable(
	'tenants',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		description: text('description'),
		comments: text('comments'),
	},
	(table) => [index('tenants_name_idx').on(table.name)],
)

export const site_groups = sqliteTable(
	'site_groups',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		parent_id: integer('parent_id').references((): AnySQLiteColumn => site_groups.id),
		name: text('name').notNull(),
		// Slug is unique per parent (service-enforced; SQLite treats NULL
		// parents as distinct so a composite unique index cannot cover roots).
		slug: text('slug').notNull(),
		description: text('description'),
		comments: text('comments'),
	},
	(table) => [
		index('site_groups_tenant_id_idx').on(table.tenant_id),
		index('site_groups_parent_id_idx').on(table.parent_id),
		index('site_groups_name_idx').on(table.name),
		uniqueIndex('site_groups_sibling_slug_idx').on(table.parent_id, table.slug),
	],
)

export const sites = sqliteTable(
	'sites',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		site_group_id: integer('site_group_id').references(() => site_groups.id),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
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

export const locations = sqliteTable(
	'locations',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		site_id: integer('site_id')
			.notNull()
			.references(() => sites.id),
		parent_id: integer('parent_id').references((): AnySQLiteColumn => locations.id),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		name: text('name').notNull(),
		// Slug is unique per parent (service-enforced; SQLite treats NULL
		// parents as distinct so a composite unique index cannot cover roots).
		slug: text('slug').notNull(),
		description: text('description'),
	},
	(table) => [
		index('locations_site_id_idx').on(table.site_id),
		index('locations_parent_id_idx').on(table.parent_id),
		uniqueIndex('locations_sibling_slug_idx').on(table.site_id, table.parent_id, table.slug),
	],
)

// ---------------------------------------------------------------------------
// P2: racks / shelves. A shelf occupies position_u..position_u+height_u-1
// (bottom-U, 1-based); bounds and overlap are enforced in the service layer
// (`services/occupancy.ts` + `db/racks.ts`) so the math stays unit-testable
// without a database. Deletes are blocked while dependents exist (service
// layer), so FKs carry no cascade.
// ---------------------------------------------------------------------------

export const racks = sqliteTable(
	'racks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
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

export const rack_shelves = sqliteTable(
	'rack_shelves',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		rack_id: integer('rack_id')
			.notNull()
			.references(() => racks.id),
		name: text('name').notNull(),
		// Bottom-U, 1-based. Occupies position_u..position_u+height_u-1.
		position_u: integer('position_u').notNull(),
		height_u: integer('height_u').notNull().default(1),
		capacity_slots: integer('capacity_slots'),
	},
	(table) => [
		index('rack_shelves_rack_id_idx').on(table.rack_id),
		index('rack_shelves_position_idx').on(table.rack_id, table.position_u),
	],
)

// ---------------------------------------------------------------------------
// P3: manufacturers / device templates. A device type belongs to one
// manufacturer; its interface stubs (`{prefix, count}`) expand into concrete
// interface names (`prefix1..prefix{count}`) when a device is instantiated
// in P4. Deletes are blocked while dependents exist (service layer), so FKs
// carry no cascade.
// ---------------------------------------------------------------------------

export const manufacturers = sqliteTable(
	'manufacturers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull().unique(),
		slug: text('slug').notNull().unique(),
		description: text('description'),
	},
	(table) => [index('manufacturers_name_idx').on(table.name)],
)

export const device_types = sqliteTable(
	'device_types',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		manufacturer_id: integer('manufacturer_id')
			.notNull()
			.references(() => manufacturers.id),
		model: text('model').notNull(),
		slug: text('slug').notNull().unique(),
		// Rack units consumed on mount. 0 = shelf-only (P4 mounts
		// those by shelf_id instead of position_u).
		u_height: integer('u_height').notNull().default(1),
		// NetBox `is_full_depth`: false = half-depth / shelf-only.
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

export const device_type_interfaces = sqliteTable(
	'device_type_interfaces',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
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
// P4: devices / interfaces. A device mounts XOR: either position_u (consumes
// the template u_height in U, validated against rack bounds plus shelf/device
// overlap) or shelf_id (consumes 0 U, shelf must sit in the same rack), never
// both. Unracked devices leave rack_id, position_u, and shelf_id all null.
// Interface rows are expanded from template stubs at create time; P5 cables
// flip `connected`. Deletes of racks/shelves/device-types are blocked while
// devices reference them (service layer); device delete removes its
// interfaces in the same transaction.
// ---------------------------------------------------------------------------

export const devices = sqliteTable(
	'devices',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		device_type_id: integer('device_type_id')
			.notNull()
			.references(() => device_types.id),
		site_id: integer('site_id').references(() => sites.id),
		location_id: integer('location_id').references(() => locations.id),
		rack_id: integer('rack_id').references(() => racks.id),
		// Rack face the device is mounted on (`front`/`rear`); only
		// meaningful for rack-mounted devices, otherwise null.
		face: text('face'),
		// Bottom-U, 1-based. Occupies position_u..position_u+u_height-1.
		position_u: integer('position_u'),
		shelf_id: integer('shelf_id').references(() => rack_shelves.id),
		status: text('status').notNull().default('active'),
		name: text('name').notNull(),
		serial: text('serial'),
		asset_tag: text('asset_tag').unique(),
		tenant_id: integer('tenant_id').references(() => tenants.id),
		description: text('description'),
	},
	(table) => [
		index('devices_type_id_idx').on(table.device_type_id),
		index('devices_site_id_idx').on(table.site_id),
		index('devices_rack_id_idx').on(table.rack_id),
		index('devices_shelf_id_idx').on(table.shelf_id),
		index('devices_tenant_id_idx').on(table.tenant_id),
		index('devices_status_idx').on(table.status),
		index('devices_name_idx').on(table.name),
	],
)

export const interfaces = sqliteTable(
	'interfaces',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		device_id: integer('device_id')
			.notNull()
			.references(() => devices.id),
		name: text('name').notNull(),
		kind: text('kind').notNull().default('ethernet'),
		connected: integer('connected').notNull().default(0),
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

export const cables = sqliteTable(
	'cables',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
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
