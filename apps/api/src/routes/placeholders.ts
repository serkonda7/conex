import { Hono } from "hono";

/**
 * Placeholder domain routers. Other agents will replace these
 * with real CRUD (tickets, devices, ...).
 * Kept as explicit stubs so workspace build + health checks pass.
 * NOTE: `clients` moved to src/routes/clients.ts — do not re-add here.
 */
export const placeholders = new Hono();

for (const name of ["tickets", "devices", "auth"]) {
  placeholders.get(`/${name}`, (c) =>
    c.json({ data: [], todo: `GET /api/v1/${name} not implemented yet` }, 501),
  );
}
