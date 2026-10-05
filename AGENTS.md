## Conventions
- Tests:
  - Update existing tests to reflect behavior changes.
  - Add tests only when explicitly requested; otherwise, ask for confirmation.
  - Running e2e tests requires `docker start conex-db` and `CONEX_DATABASE_URL=postgres://conex:conex@localhost:5432/conex`
- Errors: use `better-result` Result, not throw (request-path and service code
  must return `Result<T, Error>`; only process-startup getters like
  `getConfig()`/`getDb()` throw on missing initialization).
- Shared contracts: Valibot schemas live in `shared/src/schemas.ts`; server
  validates with `@hono/valibot-validator`, client uses the same types.
- DB: `drizzle-orm` + Postgres (Bun's built-in `bun:sql` driver), migrations in
  `server/drizzle/`, auto-run on startup; connection via `CONEX_DATABASE_URL`
  (see `server/src/db/connection.ts`).
- UI strings: never hardcode user-visible text in the client; add a key to
  `client/src/i18n/en.ts` and matching entry to `de.ts`,
  then use `t('key', { param })` / `tp('plural.key', count)`.
  Enum display values go through `client/src/i18n/labels.ts`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
