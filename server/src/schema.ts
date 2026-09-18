import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
