# Integrations
Links conex objects to external systems (TANSS, later UniFi and servereye)
and reports where the data disagrees.

conex stays the source of truth for physical inventory (racks, placement,
cabling). External systems are read-only sources: conex never writes back.
The goal is a **mapping** (which conex object is which external object) and a
**consistency report** (what is missing, unlinked or different).

## Scope
| Provider   | Tenant ↔           | Device ↔                           | Status          |
| ---------- | ------------------ | ---------------------------------- | --------------- |
| TANSS      | Company (Firma)    | PC / server                        | implemented     |
| UniFi      | Site (1..n/tenant) | UniFi device (switch, AP, gateway) | planned (5)     |
| servereye  | Customer           | Sensorhub / OCC connector          | planned (6)     |

## Decisions
- TANSS branches: each branch company maps to its own conex tenant.
- TANSS peripherals: ignored for now (PCs/servers only).
- TANSS auth: an admin creates the integration in the UI with a TANSS user
  login (verified before saving) plus the ERP API token; both are stored
  encrypted in the DB.
- Only `active` conex devices are reported as missing in TANSS.

## Framework
### Structure
```
server/src/integrations/
  types.ts          # provider interface
  registry.ts       # provider factory, keyed by provider id
  secrets.ts        # AES-GCM encryption of stored credentials
  store.ts          # integrations table CRUD, verify-before-save
  links.ts          # external_links CRUD
  snapshot.ts       # external_objects (last fetched state)
  match.ts          # key normalization + auto-match
  sync.ts           # background sync runs (manual only)
  report.ts         # consistency diff, tenant/device status cards
  tanss/
    client.ts       # tanss-api wrapper: login, re-login on 401, Result
    provider.ts     # TANSS -> normalized records
server/src/routes/integrations.ts
```
Shared contracts (request schemas, `ExternalTenantJson`,
`ExternalDeviceJson`, `IntegrationFinding`, …) live in
`shared/src/schemas.ts`.

### Provider interface
Each provider maps its API onto normalized records, so linking, matching and
the report are written once:
```ts
interface IntegrationProvider {
	id: 'tanss'
	tenantCardinality: 'one' | 'many'   // TANSS: one company per tenant
	verify(): Promise<Result<void, Error>>
	listTenants(): Promise<Result<ExternalTenantJson[], Error>>
	fetchDevices(externalTenantId: string): Promise<Result<ExternalDeviceJson[], Error>>
}
```
Provider methods return `Result`; HTTP/auth failures never throw. External
device ids are type-prefixed (`pc:123`) so peripherals can be added later
without a migration.

### Tables
```
integrations
  id, provider (unique), base_url, username,
  secrets text           -- `v1.<iv>.<ciphertext+tag>` of { password, erp_token }
  enabled, created_by, created_at, updated_at, last_login_ok_at, last_error

external_links
  id, provider, entity_type ('tenant' | 'device'),
  entity_id              -- conex id; NULL when state = 'ignored'
  external_id, external_tenant_id,
  state ('linked' | 'ignored'), method ('manual' | 'auto'),
  created_by, created_at
  unique (provider, entity_type, external_id)

external_objects         -- last fetched snapshot, used by the report
  provider, object_type ('tenant' | 'device'), external_id,
  external_tenant_id, data jsonb (normalized record), fetched_at
  primary key (provider, object_type, external_id)

sync_runs
  id, provider, tenant_id (NULL = all linked tenants),
  started_at, finished_at, state ('running' | 'ok' | 'error'), error, counts jsonb
```
- Timestamps are unix seconds.
- `jsonb` columns use a pass-through custom type in `schema.ts`: drizzle's own
  `jsonb` stringifies first, and Bun's SQL driver then stores a JSON *string*.
- Linking an entity replaces its previous link and any other row for the same
  external object (one-to-one per provider).
- `ignored` rows mark external objects that are intentionally not in conex, so
  they stop showing up as missing.
- Deleting a tenant or device deletes its links in the same transaction;
  deleting an integration deletes its links, snapshot and sync runs.

### Credentials
- Created in the UI by an admin, not in `config.toml`.
- **Saving requires a working login**: the server logs in with the entered
  username/password and fetches the company list with the ERP token. Only when
  both work is the row stored; otherwise the form shows the TANSS error (422).
  The same check runs on every edit that changes URL or credentials.
- "Test connection" runs the check without saving (blank secrets fall back to
  the stored ones).
- Secrets are AES-256-GCM encrypted with a key derived from `auth.appKey`
  (`getIntegrationKey()` in `keys.ts`). Changing the app key makes them
  unreadable; the integration then shows the error and an admin re-enters them.
- The API never returns secrets, only `has_password` / `has_erp_token`.
- TANSS users with two-factor auth cannot be used (syncs run unattended).

### TANSS client
- [`tanss-api`](https://github.com/serkonda7/tanss-api), one isolated client
  instance per credential (`createErpClient(...).instance`), never the shared
  `client` singleton.
- The user JWT (~4 h, 2 min idle timeout) is fetched lazily per sync run; a
  401 triggers one re-login and retry.
- Endpoints used:
  | Purpose                  | Call                                         | Auth  |
  | ------------------------ | -------------------------------------------- | ----- |
  | Verify credentials       | `POST /api/v1/login`                         | –     |
  | Company list             | `GET /api/erp/v1/customers`                  | ERP   |
  | PCs/servers of a company | `PUT /api/v1/pcs` `{ companyId, branches: 'COMPANY_ONLY', active: 'ACTIVE_AND_INACTIVE' }` | user |
  | Manufacturer names       | `GET /api/v1/manufacturers`                  | user  |
- The only `PUT` is the list filter on `/api/v1/pcs`; nothing is written.
- The base URL is the one under which `/api/v1/...` is reachable (include a
  path prefix such as `/backend` if the installation uses one).

### Still to verify against a real installation
- `GET /api/erp/v1/customers` is untyped in the OpenAPI spec. The client
  accepts `id`/`companyId`, `name`/`companyName`,
  `displayId`/`customerNumber`/`number`, `inactive`, `lockout`,
  `headquarterId`, and lists wrapped one level deeper. Tighten once the real
  shape is known.
- Which TANSS role the user needs for `PUT /api/v1/pcs` and
  `GET /api/v1/manufacturers` (read-only if possible).

## Sync
- `POST /integrations/:provider/sync[?tenant=]` starts a run in the background
  and answers 202 with the `running` row; clients poll
  `GET /integrations/:provider/sync/:id`. One run per provider at a time (409).
- A run always refreshes the full company list, then fetches the PCs of every
  linked company (or only the given tenant's company) and auto-links devices.
  A full run drops device snapshots of companies no longer linked.
- Sync is manual only: there is no scheduler and no interval. Runs start from
  the "Sync now" buttons or automatically right after a tenant is linked.
- Runs left `running` by a restart are marked as failed at startup.
- Linking a tenant in the UI starts a sync for that tenant right away.

## Matching
Auto-match runs after every sync, only inside one tenant ↔ company pair, and
only for devices without a link and external devices neither linked nor
ignored:
1. Serial number (upper case, separators removed; placeholders such as `N/A`,
   `0`, `Default string`, `To be filled by O.E.M.` never match).
2. Asset tag ↔ TANSS `inventoryNumber`.
3. Name (case-insensitive) — **suggestion only**, never auto-linked.

A key links automatically only when it is unique on both sides; ambiguous
matches become suggestions. Manual links are never overwritten. Tenants are
never auto-linked (a wrong company pulls in the wrong devices).

## Consistency report
Computed on request from `external_objects` + `external_links` + conex tables
(no findings table).

| Finding                      | Condition                                                     |
| ---------------------------- | ------------------------------------------------------------- |
| `tenant_unlinked`            | conex tenant without link                                     |
| `tenant_missing_in_conex`    | active company (or branch) neither linked nor ignored; global, unfiltered view only |
| `tenant_stale`               | linked company no longer returned                             |
| `tenant_inactive`            | linked company is `inactive` or `lockout`                     |
| `tenant_name_mismatch`       | normalized names differ (informational)                       |
| `device_missing_in_conex`    | active TANSS PC of a linked company, not linked, not ignored  |
| `device_missing_in_external` | **active** conex device of a linked tenant without link       |
| `device_suggestion`          | ambiguous or name-only match, awaiting confirmation           |
| `device_stale`               | linked TANSS PC no longer returned                            |
| `device_tenant_mismatch`     | linked PC's company ≠ company linked to the device's tenant   |
| `device_field_mismatch`      | per compared field (`field`, `local`, `remote`)               |
| `device_status_mismatch`     | conex `active` vs. TANSS inactive, or vice versa              |

Devices with a suggestion are not also reported as missing. Inactive TANSS
PCs and non-active conex devices are never reported as missing, but still
auto-match.

Compared fields (value missing on one side is shown, not a mismatch):
| conex                         | TANSS PC                              |
| ----------------------------- | ------------------------------------- |
| `name`                        | `name`                                |
| `serial`                      | `serialNumber`                        |
| `asset_tag`                   | `inventoryNumber`                     |
| device type manufacturer name | `manufacturerId` → manufacturer name  |
| device type `model`           | `model`                               |

## API
- `GET /integrations` — configured providers (no secrets) with last sync run.
- `POST /integrations`, `PATCH|DELETE /integrations/:provider`,
  `POST /integrations/:provider/test` — admin only.
- `POST /integrations/:provider/sync?tenant=` — editors; scoped editors only
  for their own tenant. `GET /integrations/:provider/sync/:id` — run status.
- `GET /integrations/:provider/tenants?search=` — external company picker;
  global users only (scoped users must not see other customers).
- `GET /integrations/:provider/report?tenant=&tenant_group=` — findings,
  tenant-scoped like every other list.
- `GET /integrations/:provider/tenant-status/:id`,
  `GET /integrations/:provider/device-status/:id` — detail-page cards.
- `PUT /integrations/:provider/links` `{ entity_type, entity_id, external_id }`,
  `PUT /integrations/:provider/links/ignore` `{ entity_type, external_id }`,
  `DELETE /integrations/:provider/links/:id`.
  Tenant links: global editors and admins. Device links: editors within the
  device's tenant scope; ignored devices are scoped by the company linked to
  the editor's tenant.

## UI
- `/integrations`: one card per provider with connection state, last sync and
  "Sync now"; admins set up, edit and delete (credential form with "Test
  connection").
- `/integrations/:id`: consistency report; honors the tenant selector and
  `?tenant=`, filter by finding; row actions: link tenant (company picker),
  confirm suggestion, ignore, unlink.
- Tenant detail: provider card with linked company, finding counts, link /
  change / unlink, sync.
- Device detail: provider card with the linked PC and a field comparison, or a
  picker of the company's unlinked PCs.

## Later
### Import
- "Create in conex" on `device_missing_in_conex`: prefill the device add form
  and link on save.
- "Create tenant from company" in the company picker.
- Tenant link suggestions (normalized name match) in the picker.
- Deep links into the TANSS web UI once the URL scheme is known.

### UniFi
- Tenant ↔ UniFi site, **many** sites per tenant (`tenantCardinality: 'many'`;
  `setLink` then must stop replacing the tenant's other links).
- Source: Site Manager API (`api.ui.com`, `X-API-KEY`) or per-console Network
  Integration API; decide per deployment.
- Device key: **MAC** first, then serial. conex has no MAC field today: add a
  device-level `mac_address` (or per-interface MACs) first.
- Credential shapes per provider (`IntegrationCreateSchema` becomes a
  variant on `provider`).
- Later: uplink/port data vs. conex cables (topology consistency).

### servereye
- Tenant ↔ servereye customer; devices ↔ sensorhubs / OCC connectors by
  hostname, then serial if available.
- Adds an `unmonitored` finding: conex server with no servereye link.
- Auth via `x-api-key`.
