import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Clients / CRM (ARCHITECTURE.md §3b). Everything hangs off `clients`.
// LDAP-relevant person fields are kept on `contacts`: first/last name,
// email, phone, mobile.
// ---------------------------------------------------------------------------

export const clientStatus = pgEnum("client_status", [
  "active",
  "onboarding",
  "churned",
]);

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  status: clientStatus("status").notNull().default("active"),
  billingEmail: text("billing_email"),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    addressLine1: text("address_line1"),
    city: text("city"),
    country: text("country"),
    timezone: text("timezone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sites_client_id_idx").on(t.clientId)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    // Display name, maintained by the API layer as
    // `name ?? "<firstName> <lastName>"`. Kept as a plain column
    // (not generated) so LDAP displayName sync stays trivial.
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    mobile: text("mobile"),
    title: text("title"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("contacts_client_id_idx").on(t.clientId),
    index("contacts_client_id_email_idx").on(t.clientId, t.email),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
