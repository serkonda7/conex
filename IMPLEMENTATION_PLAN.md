# conex — Implementation Plan (NetBox-lite)

Source stack: `serkonda7/teamotp` (`main`, v0.5.0).

## 1. Tech stack (mirrored from teamotp)

- Monorepo: `bun@1.4.2` workspaces (`server, client, shared, server-cli, infra`) + `turbo@2`, `biome@2`, `tsc`, `bun test`, `playwright`.
- Backend: `bun` + `hono@4` + `@hono/valibot-validator`, `drizzle-orm@0.45` + SQLite, `valibot@1`, `better-result` (Result, no throw).
- Migrations: Drizzle migrations in `server/drizzle/`, auto-run on startup, `*_DB_PATH` env pattern (`TEAMOTP_DB_PATH` precedent).
- Shared: `shared/src/schemas.ts` — Valibot contracts shared by server validation and typed client.
- Frontend: `vite@8` + `solid-js@1.9` + `@tabler/icons-solidjs`, `hono/client` (`hc`) typed fetcher, minimal custom router (copy `client/src/router.ts`).
- Auth: full local auth. Copy `server/src/sessions.ts, config.ts, audit.ts` pattern: `appKey`, session JWT + key rotation, login rate-limit, `server-cli create-user`, audit log with retention. Tenants are documentation labels only, no row-level isolation.
- Ops: `docker-compose.yml` with `server` + `client` + Caddy proxy, same as teamotp `infra/`.
- Conventions: `AGENTS.md` — `better-result` instead of throw.

## 2. Confirmed scope decisions

- Rack shelves: shelf as U accessory (occupies U, devices placed on it).
- Connections v1: L1 cables only (cable between two interfaces, status/type/label).
- Device templates v1: interface stubs (template defines stubs, expanded on deploy).
- Auth: full local auth; tenants are pure grouping.

## 3. Domain model (v1)

```
tenant_groups -> tenants
sites (tenant_id?, group as string v1)
locations (site_id, parent_id self-ref, tenant_id?)
racks (site_id, location_id?, tenant_id?, name, height_u, status)
rack_shelves (rack_id, name, position_u bottom-U, height_u, capacity_slots?)
manufacturers -> device_types (u_height, interface stubs)
device_type_interfaces (device_type_id, prefix, count, kind)
devices (device_type_id, site/location/rack_id?, position_u?, shelf_id?, status, serial, asset_tag unique, tenant_id?)
interfaces (device_id, name, kind, connected bool)
cables (a_interface_id unique, b_interface_id unique, status, kind, label)
```

Invariants:

1. Shelf occupies `position_u..position_u+height_u-1`. Overlap with devices/shelves rejected; out-of-bounds rejected.
2. Device mount is XOR: either `position_u` (consumes `u_height` U) or `shelf_id` (consumes 0 U), never both. Unracked devices allowed (`rack_id=null`, both null).
3. Template stubs expand on `POST /devices` (e.g. `{prefix:"eth",count:24}` → `eth0..eth23`). Manual interface add/edit after.
4. Cable = exactly 2 distinct interfaces, both free before connect; both `connected=true` after; delete frees them.

## 4. API sketch (Hono, Valibot-validated)

- `/api/tenant-groups`, `/api/tenants` — CRUD, filter/pagination.
- `/api/sites`, `/api/locations` — CRUD, `?tenant=`, `?site=`; delete-block if children exist.
- `/api/racks` — CRUD + `GET /racks/:id/elevation` (ordered U map).
- `/api/shelves` — CRUD, bounds/overlap validation.
- `/api/manufacturers`, `/api/device-types` — CRUD + stub rows, preview expansion.
- `/api/devices` — CRUD; create runs insert-device + expand-stubs transaction; move re-validates U/shelf.
- `/api/devices/:id/interfaces` — list/add/edit.
- `/api/cables` — CRUD; `POST /interfaces/:id/connect`, `DELETE /cables/:id`; `GET /devices/:id/trace`.
- All writes audited; all list endpoints support `?search=&page=&limit=` + relevant filters.

## 5. UI sketch (SolidJS)

- `/tenants` — groups + tenants tables.
- `/sites`, `/sites/:id` — site detail with location tree breadcrumb `site > location > …`.
- `/racks/:id` — elevation view (top-down U list), shelves as spanning blocks, click free U to place.
- `/templates` — manufacturer + device-type editor with stub preview.
- `/devices` — filterable table (site/rack/tenant/status); `/devices/:id` — detail, interface list with port status dots, rack/shelf picker, connect dialog (free-port pickers both ends), peer links `dev:eth0 <-> dev:eth1`.

## 6. Phases

### P0 Scaffold
Copy `package.json/turbo.jsonc/biome.jsonc`, `server/src/{index.ts,config.ts,sessions.ts,audit.ts,schema.ts,routes/,db/,middleware/}`, `shared/src/schemas.ts`, `client/src/{App.tsx,api.ts,router.ts}`, `server-cli/`, `infra/`, `docker-compose.yml`.
Acceptance: `bun run check/build/test` green, `db:generate` works.

### P1 Tenants / Sites / Locations + auth
Schema + CRUD, slug-unique-per-parent, hierarchy depth cap (5). Auth + audit wired first.
Acceptance: login, create tenant → site → nested locations, audit entries appear.

### P2 Racks + shelves
`racks, rack_shelves`, `getOccupancy(rack_id)` service, elevation endpoint, shelf bounds/overlap checks.
Acceptance: 42U rack, place shelf at U10 h1, overlapping device rejected.

### P3 Manufacturers + device templates
Stub rows + preview, `u_height>=0` (0 = virtual/shelf-only).
Acceptance: template `eth x24` previews `eth0..23`.

### P4 Devices + interfaces
Transactional create with stub expansion, move validation, `asset_tag` unique.
Acceptance: instantiate template into rack U and onto shelf; interface list correct.

### P5 Connections (L1)
Cable CRUD + connect/disconnect + per-device trace.
Acceptance: connect two free ports, double-connect rejected, delete frees ports.

### P6 Hardening
Global search, CSV import/export (devices/cables), audit UI, Playwright smoke: login → site → rack → device → cable.

Build order is linear: `P0 → P1 → P2 → P3 → P4 → P5 → P6`. Do not start P5 before P4 interface IDs are stable.

## 7. Testing per phase
- `bun test` unit: U-occupancy, stub expansion, cable guards, slug/hierarchy guards.
- API tests via Hono test client; Playwright smoke in P6.
- `biome ci` + `tsc` on every phase (turbo `check` depends on `^build`).
