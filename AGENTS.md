## Conventions
- Tests:
  - Update existing tests to reflect behavior changes.
  - Add tests only when explicitly requested; otherwise, ask for confirmation.
- Errors: use `better-result` Result, not throw (request-path and service code
  must return `Result<T, Error>`; only process-startup getters like
  `getConfig()`/`getDb()` throw on missing initialization).
- Shared contracts: Valibot schemas live in `shared/src/schemas.ts`; server
  validates with `@hono/valibot-validator`, client uses the same types.
- DB: `drizzle-orm` + SQLite, migrations in `server/drizzle/`, auto-run on
  startup; DB path via `CONEX_DB_PATH` env pattern (see `server/src/db/connection.ts`).
- UI strings: never hardcode user-visible text in the client; add a key to
  `client/src/i18n/en.ts` and matching entry to `de.ts`,
  then use `t('key', { param })` / `tp('plural.key', count)`.
  Enum display values go through `client/src/i18n/labels.ts`.
