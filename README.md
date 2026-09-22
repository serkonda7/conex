# conex

NetBox-lite: minimal datacenter inventory (tenants, sites, racks, devices, L1 cabling).

Monorepo (`bun` workspaces + `turbo` + `biome` + `tsc`):

- `server/` — `bun` + `hono` API, `drizzle-orm` + SQLite, Valibot validation.
- `client/` — `vite` + `solid-js` UI, typed `hono/client` fetcher.
- `shared/` — Valibot contracts shared by server validation and the client.

## Prerequisites

- `bun@1.4.2` (see `packageManager` in `package.json`).

## Run

```sh
bun install
bun run db:generate   # regenerate drizzle migrations after schema edits
```

The server needs a config file at `server/data/config.toml` (gitignored):

```toml
[auth]
appKey = "at-least-32-chars-long-random-secret-here"
secureCookies = false  # plain HTTP local dev; keep true behind HTTPS
```

Start everything, then open the UI and create the admin account in the
first-run dialog:

```sh
bun run dev
```

- API: `http://localhost:3000` (`/health` for a smoke check).
- UI: `http://localhost:5371` (proxies `/api` to the API). On a fresh
  database it shows a first-run dialog; submitting it calls
  `POST /api/auth/setup` (gated by `GET /api/auth/setup-status`,
  409 once a user exists).
- DB path: `CONEX_DB_PATH` (default `server/data/conex.db`); config path:
  `CONEX_CONFIG_PATH`. The API always listens on `0.0.0.0:3000`.

## Checks

```sh
bun run check   # tsc per workspace (depends on ^build)
bun run build   # turbo build
bun run lint:ci # biome ci
```


## Features (P6)

- Global search: `GET /api/search?q=` groups hits across tenants, sites,
  racks, devices (name/`asset_tag`/serial), and cables (label/kind).
  Search box in the nav, results at `/search`.
- CSV transfer on the Devices page (and `GET|POST /api/devices/export`,
  `/import`, same for `/api/cables/`):
  - devices columns: `name,asset_tag,device_type_slug,site_slug,rack_slug,position_u,status`
  - cables columns: `a_device,a_interface,b_device,b_interface,label,kind,status`
  - imports validate every row, create the good ones, and report per-row
    errors.
- Topology view at `/topology` (`GET /api/topology?site=&device=`):
  devices as nodes, cables as edges (SVG graph with site/focus filters,
  keyboard-accessible selection, and an edge table fallback).
- Cable traces (BFS shortest paths, `?depth=1..10`, default 4):
  - `GET /api/devices/:id/trace` — direct peer `links` plus multi-hop
    `paths` (also shown on the device page with a depth picker).
  - `GET /api/devices/:id/interfaces/:ifaceId/trace` — all paths
    starting at one port.
  - `GET /api/cables/:id/trace` — endpoints plus onward paths from each
    side (linked from each Connections row via Trace).
