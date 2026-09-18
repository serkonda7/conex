import {
	type AnySQLiteColumn,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// P0 minimal schema: auth + audit only. Domain tables (tenants, sites, racks,
// devices, cables) are added in P1-P5.
export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	password_hash: text('password_hash'),
	provider: text('provider').notNull().default('local'),
	provider_id: text('provider_id').unique(),
})

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		user_id: text('user_id')
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

export const access_log = sqliteTable(
	'access_log',
	{
		id: text('id').primaryKey(),
		user_id: text('user_id').notNull(),
		user_email: text('user_email').notNull(),
		action: text('action').notNull(),
		resource_id: text('resource_id'),
		created_at: integer('created_at').notNull(),
	},
	(table) => [index('access_log_created_at_idx').on(table.created_at)],
)

// ---------------------------------------------------------------------------
// P1: tenants / sites / locations. Tenants are documentation labels only —
// no row-level isolation; grouping is by nullable FK, delete-blocked when
// children exist (enforced in the service layer, not by FK cascade).
// ---------------------------------------------------------------------------

export const tenant_groups = sqliteTable(
	'tenant_groups',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		description: text('description'),
	},
	(table) => [index('tenant_groups_name_idx').on(table.name)],
)

export const tenants = sqliteTable(
	'tenants',
	{
		id: text('id').primaryKey(),
		group_id: text('group_id').references(() => tenant_groups.id),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		description: text('description'),
	},
	(table) => [
		index('tenants_group_id_idx').on(table.group_id),
		index('tenants_name_idx').on(table.name),
	],
)

export const sites = sqliteTable(
	'sites',
	{
		id: text('id').primaryKey(),
		tenant_id: text('tenant_id').references(() => tenants.id),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		// v1 keeps the site group as a free-form label, not a FK.
		group: text('group'),
		description: text('description'),
	},
	(table) => [
		index('sites_tenant_id_idx').on(table.tenant_id),
		index('sites_name_idx').on(table.name),
	],
)

export const locations = sqliteTable(
	'locations',
	{
		id: text('id').primaryKey(),
		site_id: text('site_id')
			.notNull()
			.references(() => sites.id),
		parent_id: text('parent_id').references((): AnySQLiteColumn => locations.id),
		tenant_id: text('tenant_id').references(() => tenants.id),
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
