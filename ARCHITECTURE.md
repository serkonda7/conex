# CONEX - MSP Management Tool (ITSM) - Architecture

Designed for a small MSP of < 10 people. Single-tenant PSA: one deploy, staff sees all clients, data partitioned by `client_id`. No microservices, no RLS on day 1.

Techstack: Bun, TS, Postgres, Biome, Hono, Valibot, SolidJS, Turbo, Tabler Icons.

## 1. Monorepo Architecture

`turbo + bun workspaces`:

```
conex/
  apps/
    api/      # hono + bun runtime
    web/      # solidjs + vite + @solidjs/router
  packages/
    db/       # drizzle-orm + postgres-js + migrations
    schemas/  # valibot shared contracts (single source of truth)
    ui/       # solidjs primitives, layout, tabler-icons wrapper
    auth/     # better-auth config + hono middleware
  turbo.json
  biome.json
  docker-compose.yml # postgres:16 + api + web
```

Why this:

* `apps/api`: one Hono app, `hono/bun` adapter. Modules per domain, not per microservice.
* `apps/web`: Vite SPA, no SSR. `SolidStart` is overkill for internal tool.
* `packages/db`: `drizzle-orm` is the best fit for Bun+TS+PG. Alternative is `kysely`. Don't use raw `postgres.js` everywhere.
* `packages/schemas`: Valibot schemas imported by both Hono (`@hono/valibot-validator`) and Solid forms. Prevents drift.
* Single `postgres:16` DB. One `api` deployment handles cron/automation with `bun:cron` or a `/internal/cron` route. No separate worker until you need RMM polling at scale.

`turbo.json` pipeline: `build -> [db:generate, schemas:build]`, `dev: --parallel`, `db:migrate` runs before `api#start`.

`biome.json`: lint+format for all `apps/*`, `packages/*`. No ESLint/Prettier.

## 2. Core Domain Model

9 domains for MVP. Everything hangs off `clients`:

```
users (staff)
  |
clients (customer orgs you manage) 1--n sites 1--n contacts
  | 1--n devices/assets
  | 1--n tickets 1--n comments, time_entries, attachments
  | 1--n contracts/slas
  | 1--n kb_articles (scoped or global)
alerts -> tickets (monitoring ingress)
audit_logs, notifications (cross-cutting)
```

Auth: staff-only for MVP. Client portal is Phase 3. This avoids multi-tenant RLS complexity now. App-level `WHERE client_id = ?` is enough.

Roles: `owner, admin, dispatcher, technician, billing, readonly`. Simple RBAC table, not ABAC.

## 3. Postgres Data Structures

Conventions: `uuid PK DEFAULT gen_random_uuid()`, `timestamptz DEFAULT now()`, soft-delete only for `tickets/devices` via `deleted_at`. Everything else hard delete with FK `CASCADE` / `RESTRICT`.

### a) Identity

```sql
users(id, name, email UNIQUE, password_hash NULL, role: enum, avatar_url, is_active, last_login_at, created_at)
sessions(id, user_id FK, token_hash, expires_at) -- managed by better-auth
```

### b) Clients / CRM

```sql
clients(id, name UNIQUE, slug UNIQUE, status: active|onboarding|churned, billing_email, phone, notes, created_at)
sites(id, client_id FK CASCADE, name, address_line1, city, country, timezone, is_primary, created_at)
contacts(id, client_id FK CASCADE, site_id FK NULL, name, email, phone, title, is_primary, portal_access BOOLEAN DEFAULT false)
```

Index: `sites(client_id)`, `contacts(client_id, email)`.

### c) Assets (RMM-lite)

```sql
asset_types(id, slug UNIQUE, name) -- laptop, server, printer, network, license, other
devices(id, client_id FK CASCADE, site_id FK NULL, asset_type_id FK, hostname, serial_number, os, ip_address, specs JSONB, purchase_date, warranty_ends, status: active|retired|repair, last_seen_at)
-- UNIQUE(client_id, serial_number) WHERE serial_number IS NOT NULL
```

Use `JSONB specs` for flexibility, don't EAV-model it. GIN index on `specs` if you search.

### d) Tickets (core ITSM)

```sql
tickets(id, number SERIAL per-install, client_id FK, site_id FK NULL, contact_id FK NULL, device_id FK NULL,
  title, description TEXT, status: new|open|pending|on_hold|resolved|closed,
  priority: low|normal|high|urgent, category: incident|request|problem|change,
  assignee_id FK users NULL, created_by FK users, due_at NULL, resolved_at NULL, closed_at NULL,
  sla_due_at NULL, created_at, updated_at)
ticket_comments(id, ticket_id FK CASCADE, author_id FK users, body TEXT, is_internal BOOLEAN DEFAULT true, created_at)
ticket_attachments(id, ticket_id FK CASCADE, file_key TEXT, filename, mime, size_bytes, uploaded_by FK)
ticket_history(id, ticket_id FK CASCADE, actor_id FK, from_status, to_status, changed_at) -- append-only for SLA audit
```

Indexes: `(status, priority, sla_due_at)`, `(client_id, status)`, `(assignee_id, status)`. Full-text: `to_tsvector(title || description)` GIN for search.

Keep statuses as PG `enum`, not lookup table. <10 people don't need admin-customizable workflows yet.

### e) Time + Contracts + SLA

```sql
time_entries(id, ticket_id FK CASCADE, user_id FK, started_at, duration_minutes INT CHECK >0, billable BOOLEAN, note, created_at)
contracts(id, client_id FK CASCADE, name, type: managed|block_hours|breakfix, starts_on, ends_on, hours_included INT NULL, rate_cents INT, sla_response_mins INT, sla_resolve_mins INT, is_active)
contract_consumption VIEW: SUM(time_entries) per contract period
```

### f) Knowledge + Monitoring + System

```sql
kb_articles(id, client_id FK NULL /* NULL=global */, title, slug UNIQUE, body_markdown, tags TEXT[], author_id FK, is_published, updated_at)
alerts(id, client_id FK, device_id FK NULL, source: email|webhook|agent, external_id UNIQUE, severity, message, payload JSONB, status: new|converted|ignored, ticket_id FK NULL, received_at)
notifications(id, user_id FK, ticket_id FK NULL, type, payload JSONB, read_at NULL, created_at)
audit_logs(id, actor_id FK, action, entity, entity_id, diff JSONB, created_at) -- append-only
```

Files: store bytes in S3-compatible (R2/MinIO), only metadata in `ticket_attachments`.

Shared Valibot contract example:

```ts
// packages/schemas/src/ticket.ts
import * as v from 'valibot';
export const TicketStatus = v.picklist(['new','open','pending','on_hold','resolved','closed']);
export const CreateTicket = v.object({
  clientId: v.string(),
  title: v.pipe(v.string(), v.minLength(3)),
  description: v.string(),
  priority: v.optional(v.picklist(['low','normal','high','urgent']))
});
export type CreateTicketInput = v.InferInput<typeof CreateTicket>;
```

## 4. API Design - Hono

`/api/v1/...` REST, JSON, Valibot validator middleware, OpenAPI via `@hono/zod-openapi` pattern but with Valibot.

```
GET/POST   /clients, /clients/:id/sites, /clients/:id/contacts
GET/POST   /devices?clientId=
GET/POST   /tickets?status=&assignee=&clientId=&q=
PATCH      /tickets/:id/status, /tickets/:id/assign
POST       /tickets/:id/comments, /tickets/:id/time
GET/POST   /contracts, /kb, /alerts/inbound/:source (HMAC signed)
GET        /dashboard/queue, /dashboard/sla-breaches
```

Middleware chain: `logger -> auth(session cookie) -> rbac -> valibotValidator -> handler`. All list routes: `?limit=50&cursor=` keyset pagination, never offset.

Folder: `apps/api/src/routes/tickets.ts, clients.ts, devices.ts, ...`, `apps/api/src/middleware/auth.ts, rbac.ts`, `apps/api/src/lib/sla.ts`.

## 5. Web Design - SolidJS

Vite + `@solidjs/router` + `@tanstack/solid-query` + Valibot forms (`@modular-forms/solid` or `felte`).

Routes:

```
/queue (default dispatcher view), /tickets/:id, /clients, /clients/:id, /assets, /kb, /reports/time, /settings/users
```

State: server state in TanStack Query keyed `['tickets', filters]`, no global store. UI primitives in `packages/ui`: `Table, Drawer, StatusBadge, PriorityDot, TimeInput`. Icons: `solid-tabler-icons` only, no emoji.

Queue-first UX: left list + right detail, `Cmd+K` search, `I` internal note vs `R` public reply distinction.

## 6. MVP Phases for <10 Staff

1. **P0 Scaffold:** turbo+biome+docker, auth, `clients/sites/contacts`, `tickets+comments`.
2. **P1 Daily driver:** `devices`, assignment, SLA timers, full-text search, file upload.
3. **P2 Money:** `time_entries`, `contracts`, basic invoicing export CSV.
4. **P3 Scale:** client portal (`portal_access=true` + scoped RLS), `alerts->ticket` auto-convert, KB.

Do not add: CMDB graph, change approval workflows, multi-currency billing, asset agent. Integrate: email-in via webhook, Stripe/Lexoffice export, Uptime Kuma / Checkmk -> `POST /alerts/inbound`.
