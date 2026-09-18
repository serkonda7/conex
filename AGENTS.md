## Conventions

- Errors: use `better-result` Result, not throw (request-path and service code
  must return `Result<T, Error>`; only process-startup getters like
  `getConfig()`/`getDb()` throw on missing initialization).
- Monorepo: `bun` workspaces (`server`, `client`, `shared`, `server-cli`,
  `infra`) + `turbo` + `biome` + `tsc`.
- Shared contracts: Valibot schemas live in `shared/src/schemas.ts`; server
  validates with `@hono/valibot-validator`, client uses the same types.
- DB: `drizzle-orm` + SQLite, migrations in `server/drizzle/`, auto-run on
  startup; DB path via `CONEX_DB_PATH` env pattern (see `server/src/db/connection.ts`).
- Auth: local auth only; `appKey` signs session JWTs, `server-cli create-user`
  provisions users.
