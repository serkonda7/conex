import { db, schema } from "@conex/db";
import {
	ClientCreate,
	ClientSiteParam,
	ClientUpdate,
	ContactCreate,
	IdParam,
	PaginationQuery,
	SiteCreate,
	SiteUpdate,
} from "@conex/schemas";
import { vValidator } from "@hono/valibot-validator";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import {
	contactDisplayName,
	isUniqueViolation,
	notFound,
	slugify,
} from "../lib/domain.js";
import {
	decodeCursor,
	encodeCursor,
	escapeLike,
	keysetFilter,
} from "../lib/pagination.js";
import { validationHook } from "../lib/validate.js";

/**
 * Clients (tenants) + nested sites/contacts.
 *
 * @openapi
 * GET    /api/v1/clients
 * POST   /api/v1/clients
 * GET    /api/v1/clients/:id
 * PATCH  /api/v1/clients/:id
 * DELETE /api/v1/clients/:id
 * GET    /api/v1/clients/:id/sites
 * POST   /api/v1/clients/:id/sites
 * PATCH  /api/v1/clients/:id/sites/:siteId
 * DELETE /api/v1/clients/:id/sites/:siteId
 * GET    /api/v1/clients/:id/contacts
 * POST   /api/v1/clients/:id/contacts
 */
export const clients = new Hono();

async function uniqueClientSlug(base: string): Promise<string> {
	const clean = slugify(base);
	const existing = await db
		.select({ slug: schema.clients.slug })
		.from(schema.clients)
		.where(ilike(schema.clients.slug, `${clean}%`));
	const taken = new Set(existing.map((r) => r.slug));
	if (!taken.has(clean)) return clean;
	let n = 2;
	while (taken.has(`${clean}-${n}`)) n += 1;
	return `${clean}-${n}`;
}

async function requireClient(id: string) {
	const [row] = await db
		.select()
		.from(schema.clients)
		.where(eq(schema.clients.id, id))
		.limit(1);
	return row ?? null;
}

// --- clients ---------------------------------------------------------------

clients.get(
	"/clients",
	vValidator("query", PaginationQuery, validationHook),
	async (c) => {
		const { limit: rawLimit, cursor, q } = c.req.valid("query");
		const limit = rawLimit ?? 50;
		const filters = [];
		if (q) {
			const like = `%${escapeLike(q)}%`;
			filters.push(
				or(
					ilike(schema.clients.name, like),
					ilike(schema.clients.slug, like),
				),
			);
		}
		if (cursor) {
			const parsed = decodeCursor(cursor);
			if (!parsed) return c.json({ error: "Invalid cursor" }, 400);
			filters.push(
				keysetFilter(
					schema.clients.createdAt,
					schema.clients.id,
					parsed,
				),
			);
		}
		const rows = await db
			.select()
			.from(schema.clients)
			.where(filters.length > 0 ? and(...filters) : undefined)
			.orderBy(desc(schema.clients.createdAt), desc(schema.clients.id))
			.limit(limit + 1);
		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const last = page[page.length - 1];
		return c.json({
			data: page,
			pagination: {
				limit,
				nextCursor:
					hasMore && last
						? encodeCursor(last.createdAt, last.id)
						: null,
			},
		});
	},
);

clients.post(
	"/clients",
	vValidator("json", ClientCreate, validationHook),
	async (c) => {
		const input = c.req.valid("json");
		const slug = input.slug ?? (await uniqueClientSlug(input.name));
		try {
			const [row] = await db
				.insert(schema.clients)
				.values({
					name: input.name,
					slug,
					status: input.status ?? "active",
					billingEmail: input.billingEmail ?? null,
					phone: input.phone ?? null,
					notes: input.notes ?? null,
				})
				.returning();
			return c.json({ data: row }, 201);
		} catch (e) {
			if (isUniqueViolation(e)) {
				return c.json(
					{ error: "Client with this name or slug already exists" },
					409,
				);
			}
			throw e;
		}
	},
);

clients.get(
	"/clients/:id",
	vValidator("param", IdParam, validationHook),
	async (c) => {
		const { id } = c.req.valid("param");
		const row = await requireClient(id);
		if (!row) return notFound(c, "Client");
		return c.json({ data: row });
	},
);

clients.patch(
	"/clients/:id",
	vValidator("param", IdParam, validationHook),
	vValidator("json", ClientUpdate, validationHook),
	async (c) => {
		const { id } = c.req.valid("param");
		const input = c.req.valid("json");
		if (Object.keys(input).length === 0) {
			return c.json({ error: "No fields to update" }, 400);
		}
		try {
			const [row] = await db
				.update(schema.clients)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(schema.clients.id, id))
				.returning();
			if (!row) return notFound(c, "Client");
			return c.json({ data: row });
		} catch (e) {
			if (isUniqueViolation(e)) {
				return c.json(
					{ error: "Client with this name or slug already exists" },
					409,
				);
			}
			throw e;
		}
	},
);

clients.delete(
	"/clients/:id",
	vValidator("param", IdParam, validationHook),
	async (c) => {
		const { id } = c.req.valid("param");
		const [row] = await db
			.delete(schema.clients)
			.where(eq(schema.clients.id, id))
			.returning({ id: schema.clients.id });
		if (!row) return notFound(c, "Client");
		// sites + contacts cascade via FK.
		return c.json({ data: { id: row.id, deleted: true } });
	},
);

// --- nested sites ------------------------------------------------------------

clients.get(
	"/clients/:id/sites",
	vValidator("param", IdParam, validationHook),
	async (c) => {
		const { id } = c.req.valid("param");
		if (!(await requireClient(id))) return notFound(c, "Client");
		const rows = await db
			.select()
			.from(schema.sites)
			.where(eq(schema.sites.clientId, id))
			.orderBy(desc(schema.sites.isPrimary), schema.sites.createdAt);
		return c.json({ data: rows });
	},
);

clients.post(
	"/clients/:id/sites",
	vValidator("param", IdParam, validationHook),
	vValidator("json", SiteCreate, validationHook),
	async (c) => {
		const { id } = c.req.valid("param");
		if (!(await requireClient(id))) return notFound(c, "Client");
		const input = c.req.valid("json");
		if (input.isPrimary) {
			await db
				.update(schema.sites)
				.set({ isPrimary: false })
				.where(eq(schema.sites.clientId, id));
		}
		const [row] = await db
			.insert(schema.sites)
			.values({
				clientId: id,
				name: input.name,
				addressLine1: input.addressLine1 ?? null,
				city: input.city ?? null,
				country: input.country ?? null,
				timezone: input.timezone ?? null,
				isPrimary: input.isPrimary ?? false,
			})
			.returning();
		return c.json({ data: row }, 201);
	},
);

clients.patch(
	"/clients/:id/sites/:siteId",
	vValidator("param", ClientSiteParam, validationHook),
	vValidator("json", SiteUpdate, validationHook),
	async (c) => {
		const { id, siteId } = c.req.valid("param");
		const input = c.req.valid("json");
		if (Object.keys(input).length === 0) {
			return c.json({ error: "No fields to update" }, 400);
		}
		if (input.isPrimary) {
			await db
				.update(schema.sites)
				.set({ isPrimary: false })
				.where(eq(schema.sites.clientId, id));
		}
		const [row] = await db
			.update(schema.sites)
			.set(input)
			.where(
				and(eq(schema.sites.id, siteId), eq(schema.sites.clientId, id)),
			)
			.returning();
		if (!row) return notFound(c, "Site");
		return c.json({ data: row });
	},
);

clients.delete(
	"/clients/:id/sites/:siteId",
	vValidator("param", ClientSiteParam, validationHook),
	async (c) => {
		const { id, siteId } = c.req.valid("param");
		const [row] = await db
			.delete(schema.sites)
			.where(
				and(eq(schema.sites.id, siteId), eq(schema.sites.clientId, id)),
			)
			.returning({ id: schema.sites.id });
		if (!row) return notFound(c, "Site");
		// linked contacts keep their row, site_id -> NULL via FK.
		return c.json({ data: { id: row.id, deleted: true } });
	},
);

// --- nested contacts -----------------------------------------------------------

clients.get(
	"/clients/:id/contacts",
	vValidator("param", IdParam, validationHook),
	vValidator("query", PaginationQuery, validationHook),
	async (c) => {
		const { id } = c.req.valid("param");
		if (!(await requireClient(id))) return notFound(c, "Client");
		const { limit: rawLimit, cursor, q } = c.req.valid("query");
		const limit = rawLimit ?? 50;
		const filters: (SQL | undefined)[] = [eq(schema.contacts.clientId, id)];
		if (q) {
			const like = `%${escapeLike(q)}%`;
			filters.push(
				or(
					ilike(schema.contacts.name, like),
					ilike(schema.contacts.email, like),
				),
			);
		}
		if (cursor) {
			const parsed = decodeCursor(cursor);
			if (!parsed) return c.json({ error: "Invalid cursor" }, 400);
			filters.push(
				keysetFilter(
					schema.contacts.createdAt,
					schema.contacts.id,
					parsed,
				),
			);
		}
		const rows = await db
			.select()
			.from(schema.contacts)
			.where(and(...filters))
			.orderBy(desc(schema.contacts.createdAt), desc(schema.contacts.id))
			.limit(limit + 1);
		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const last = page[page.length - 1];
		return c.json({
			data: page,
			pagination: {
				limit,
				nextCursor:
					hasMore && last
						? encodeCursor(last.createdAt, last.id)
						: null,
			},
		});
	},
);

clients.post(
	"/clients/:id/contacts",
	vValidator("param", IdParam, validationHook),
	vValidator("json", ContactCreate, validationHook),
	async (c) => {
		const { id } = c.req.valid("param");
		if (!(await requireClient(id))) return notFound(c, "Client");
		const input = c.req.valid("json");
		if (input.siteId) {
			const [site] = await db
				.select()
				.from(schema.sites)
				.where(eq(schema.sites.id, input.siteId))
				.limit(1);
			if (!site) return notFound(c, "Site");
			if (site.clientId !== id) {
				return c.json(
					{ error: "Site does not belong to this client" },
					400,
				);
			}
		}
		if (input.isPrimary) {
			await db
				.update(schema.contacts)
				.set({ isPrimary: false })
				.where(eq(schema.contacts.clientId, id));
		}
		const [row] = await db
			.insert(schema.contacts)
			.values({
				clientId: id,
				siteId: input.siteId ?? null,
				firstName: input.firstName ?? null,
				lastName: input.lastName ?? null,
				name: contactDisplayName({
					firstName: input.firstName,
					lastName: input.lastName,
					name: input.name,
				}),
				email: input.email ?? null,
				phone: input.phone ?? null,
				mobile: input.mobile ?? null,
				title: input.title ?? null,
				isPrimary: input.isPrimary ?? false,
			})
			.returning();
		return c.json({ data: row }, 201);
	},
);
