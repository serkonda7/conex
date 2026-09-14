import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export interface PageCursor {
  /** created_at ISO timestamp */
  t: string;
  /** row id (uuid) */
  i: string;
}

/** Opaque keyset cursor: base64url({t: createdAt, i: id}). */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ t: createdAt.toISOString(), i: id }),
  ).toString("base64url");
}

/** Returns null when the cursor is malformed (caller maps to 400). */
export function decodeCursor(cursor: string): PageCursor | null {
  try {
    const raw = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("t" in raw) ||
      !("i" in raw)
    ) {
      return null;
    }
    const { t, i } = raw as { t: unknown; i: unknown };
    if (typeof t !== "string" || typeof i !== "string") return null;
    if (Number.isNaN(Date.parse(t)) || i.length === 0) return null;
    return { t, i };
  } catch {
    return null;
  }
}

/**
 * Keyset WHERE fragment for `ORDER BY created_at DESC, id DESC` lists.
 * Matches rows strictly older than the cursor position.
 */
export function keysetFilter(
  createdAt: AnyPgColumn,
  id: AnyPgColumn,
  cursor: PageCursor,
): SQL {
  return sql`(${createdAt} < ${cursor.t}::timestamptz OR (${createdAt} = ${cursor.t}::timestamptz AND ${id} < ${cursor.i}::uuid))`;
}

/** Escape LIKE wildcards in free-text search input. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
