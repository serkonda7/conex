import type { Context } from "hono";

/** Build a URL-safe slug from a client name. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
  return slug || "client";
}

/** Display name for a person: explicit override, else first + last. */
export function contactDisplayName(input: {
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string | null;
}): string {
  if (input.name?.trim()) return input.name.trim();
  const full = [input.firstName, input.lastName]
    .filter((p) => p?.trim())
    .join(" ")
    .trim();
  return full || input.email?.trim() || "Unnamed contact";
}

/**
 * Postgres unique-violation (SQLSTATE 23505). Drizzle wraps driver
 * errors in DrizzleQueryError, so unwrap `cause` before checking.
 */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && typeof cur === "object" && cur !== null; i++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export function notFound(c: Context, entity: string) {
  return c.json({ error: `${entity} not found` }, 404);
}
