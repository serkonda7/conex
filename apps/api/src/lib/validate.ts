import type { Context } from "hono";

interface IssuePathItem {
  key: unknown;
}

interface ValidationResult {
  success: boolean;
  issues?: Array<{ message: string; path?: Array<IssuePathItem> }>;
}

/**
 * Shared @hono/valibot-validator hook: shape all schema failures
 * as `{ error, issues: [{ path, message }] }` with status 400.
 */
export function validationHook(result: ValidationResult, c: Context) {
  if (!result.success) {
    return c.json(
      {
        error: "Validation failed",
        issues: (result.issues ?? []).map((i) => ({
          path: (i.path ?? []).map((p) => String(p.key)).join("."),
          message: i.message,
        })),
      },
      400,
    );
  }
}
