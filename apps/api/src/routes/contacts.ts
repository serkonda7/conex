import { db, schema } from "@conex/db";
import {
  ContactAssign,
  ContactListQuery,
  ContactUpdate,
  IdParam,
} from "@conex/schemas";
import { vValidator } from "@hono/valibot-validator";
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { contactDisplayName, notFound } from "../lib/domain.js";
import {
  decodeCursor,
  encodeCursor,
  escapeLike,
  keysetFilter,
} from "../lib/pagination.js";
import { validationHook } from "../lib/validate.js";

/**
 * People directory: list / edit / (re-)assign contacts across
 * clients and sites.
 *
 * @openapi
 * GET    /api/v1/contacts?clientId=&siteId=&q=&limit=&cursor=
 * GET    /api/v1/contacts/:id
 * PATCH  /api/v1/contacts/:id
 * DELETE /api/v1/contacts/:id
 * POST   /api/v1/contacts/:id/assign  { siteId | clientId }
 */
export const contacts = new Hono();

async function clearPrimaryFlags(clientId: string, exceptId?: string) {
  const conds = [eq(schema.contacts.clientId, clientId)];
  if (exceptId) conds.push(ne(schema.contacts.id, exceptId));
  await db
    .update(schema.contacts)
    .set({ isPrimary: false })
    .where(and(...conds));
}

contacts.get(
  "/contacts",
  vValidator("query", ContactListQuery, validationHook),
  async (c) => {
    const {
      limit: rawLimit,
      cursor,
      q,
      clientId,
      siteId,
    } = c.req.valid("query");
    const limit = rawLimit ?? 50;
    const filters = [];
    if (clientId) filters.push(eq(schema.contacts.clientId, clientId));
    if (siteId) filters.push(eq(schema.contacts.siteId, siteId));
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
        keysetFilter(schema.contacts.createdAt, schema.contacts.id, parsed),
      );
    }
    const rows = await db
      .select()
      .from(schema.contacts)
      .where(filters.length > 0 ? and(...filters) : undefined)
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
          hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      },
    });
  },
);

contacts.get(
  "/contacts/:id",
  vValidator("param", IdParam, validationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const [row] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, id))
      .limit(1);
    if (!row) return notFound(c, "Contact");
    return c.json({ data: row });
  },
);

contacts.patch(
  "/contacts/:id",
  vValidator("param", IdParam, validationHook),
  vValidator("json", ContactUpdate, validationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    if (Object.keys(input).length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }
    const [existing] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, id))
      .limit(1);
    if (!existing) return notFound(c, "Contact");

    // Target client after a potential move.
    const targetClientId = input.clientId ?? existing.clientId;

    if (input.clientId && input.clientId !== existing.clientId) {
      const [client] = await db
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(eq(schema.clients.id, input.clientId))
        .limit(1);
      if (!client) return notFound(c, "Client");
    }

    // Resolve the target site: explicit value wins; a client move
    // without a site drops the (now foreign) site assignment.
    let targetSiteId: string | null | undefined = existing.siteId;
    if (input.siteId !== undefined) {
      targetSiteId = input.siteId;
    } else if (input.clientId && input.clientId !== existing.clientId) {
      targetSiteId = null;
    }
    if (targetSiteId) {
      const [site] = await db
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.id, targetSiteId))
        .limit(1);
      if (!site) return notFound(c, "Site");
      if (site.clientId !== targetClientId) {
        return c.json(
          { error: "Site does not belong to the contact's client" },
          400,
        );
      }
    }

    const name = contactDisplayName({
      firstName: input.firstName ?? existing.firstName ?? undefined,
      lastName: input.lastName ?? existing.lastName ?? undefined,
      name: input.name ?? existing.name,
    });

    if (input.isPrimary) await clearPrimaryFlags(targetClientId, id);

    const [row] = await db
      .update(schema.contacts)
      .set({
        ...input,
        siteId: targetSiteId ?? null,
        name,
        updatedAt: new Date(),
      })
      .where(eq(schema.contacts.id, id))
      .returning();
    return c.json({ data: row });
  },
);

contacts.delete(
  "/contacts/:id",
  vValidator("param", IdParam, validationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const [row] = await db
      .delete(schema.contacts)
      .where(eq(schema.contacts.id, id))
      .returning({ id: schema.contacts.id });
    if (!row) return notFound(c, "Contact");
    return c.json({ data: { id: row.id, deleted: true } });
  },
);

contacts.post(
  "/contacts/:id/assign",
  vValidator("param", IdParam, validationHook),
  vValidator("json", ContactAssign, validationHook),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const [existing] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, id))
      .limit(1);
    if (!existing) return notFound(c, "Contact");

    const targetClientId = input.clientId ?? existing.clientId;

    if (input.clientId && input.clientId !== existing.clientId) {
      const [client] = await db
        .select({ id: schema.clients.id })
        .from(schema.clients)
        .where(eq(schema.clients.id, input.clientId))
        .limit(1);
      if (!client) return notFound(c, "Client");
    }

    // Site resolution: explicit null detaches; omitted keeps the
    // current site unless the client changed (then detach).
    let targetSiteId: string | null | undefined = existing.siteId;
    if (input.siteId !== undefined) {
      targetSiteId = input.siteId;
    } else if (targetClientId !== existing.clientId) {
      targetSiteId = null;
    }
    if (targetSiteId) {
      const [site] = await db
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.id, targetSiteId))
        .limit(1);
      if (!site) return notFound(c, "Site");
      if (site.clientId !== targetClientId) {
        return c.json(
          { error: "Site does not belong to the contact's client" },
          400,
        );
      }
    }

    const [row] = await db
      .update(schema.contacts)
      .set({
        clientId: targetClientId,
        siteId: targetSiteId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.contacts.id, id))
      .returning();
    return c.json({ data: row });
  },
);
