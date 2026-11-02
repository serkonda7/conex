## Conventions
- Tests:
  - Update existing tests to reflect behavior changes.
  - Add tests only when explicitly requested; otherwise, ask for confirmation.
  - Running e2e tests requires `docker start conex-dev-db` and `CONEX_DATABASE_URL=postgres://conex:conex@localhost:5432/conex`
- Errors: use `better-result` Result, not throw (request-path and service code
  must return `Result<T, Error>`; only process-startup getters like
  `getConfig()`/`getDb()` throw on missing initialization).
- Shared contracts: Valibot schemas live in `shared/src/schemas.ts`; server
  validates with `@hono/valibot-validator`, client uses the same types.
- Device-type import rules: `DeviceTypeYamlSchema`, the port and type constants
  and the port rules live in `packages/device-schema`, published as
  `@serkonda7/conex-device-schema` and re-exported by `shared/src/schemas.ts`.
  It depends on `valibot` only, so it returns plain values instead of `Result`.
  conex-device-types validates with a published version: release after changes.
- DB: `drizzle-orm` + Postgres (Bun's built-in `bun:sql` driver), migrations in
  `server/drizzle/`, auto-run on startup; connection via `CONEX_DATABASE_URL`
  (see `server/src/db/connection.ts`).
- UI strings: never hardcode user-visible text in the client; add a key to
  `client/src/i18n/en.ts` and matching entry to `de.ts`,
  then use `t('key', { param })` / `tp('plural.key', count)`.
  Enum display values go through `client/src/i18n/labels.ts`.
- Design decisions: read `docs/design/decisions/` before UI changes and follow
  the accepted decisions there. Record significant new design choices as a new
  numbered file; to reverse one, add a new decision that replaces it.
