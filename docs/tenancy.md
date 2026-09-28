# Tenancy
Plan for tenant groups, a global tenant selector and (later) strict isolation.
The only cross-tenant links in practice are site-to-site VPNs; there are no
shared racks or cables between customers.

## Phase 1: tenant groups + selector (implemented)
### Tenant groups
- New table `tenant_groups` (`name`, `slug` unique, `description`, `comments`).
- Flat: no `parent_id`, no nesting.
- `tenants.tenant_group_id` (nullable FK): a tenant is in at most one group.
- Groups never own inventory. Sites, racks, devices, ... keep pointing at one
  tenant; a group is only a way to select several tenants at once.
- Deleting a group is blocked while tenants are assigned to it.
- Writes (create/rename/delete, assigning tenants) are limited to global
  editors and admins, like tenants. Scoped users only see the group of their
  own tenant.

### API
- `GET/POST /tenant-groups`, `GET/PATCH/DELETE /tenant-groups/:id`.
- The list includes `tenant_count`.
- `GET /tenants?group=<id>` lists the tenants of one group.
- Every tenant-filtered list (`/sites`, `/site-groups`, `/locations`,
  `/racks`, `/devices`, `/topology`) accepts `?tenant_group=<id>` next to
  `?tenant=<id>`. The group resolves to its tenant ids server-side
  (`resolveTenantGroupIds` in `db/tenancy.ts`); the list query then filters
  with `tenant_id IN (...)`. An empty group matches nothing.
- Scoped users: `?tenant_group=` naming a group that does not contain their
  tenant answers 403, the same way a foreign `?tenant=` does.

### Selector
- Dropdown in the top bar: **All tenants**, then each group, then each tenant
  (grouped under its tenant group).
- The choice is global (all tabs) and saved in `localStorage`.
- Scoped users see their tenant as a fixed label instead of a dropdown.
- Applies to: list pages of sites, site groups, locations, racks and devices,
  the tenant list (group only), and the topology view.
- An explicit `?tenant=` in a page URL (e.g. "view all" links on a detail
  page) wins over the selector.
- Per-page tenant filters only offer tenants inside the selected context.
- Create forms (sites, site groups, locations, racks, devices) prefill the
  tenant when a single tenant is selected.
- Does not apply to detail pages (links always open), catalog data
  (manufacturers, device types, rack types), users, interfaces and
  connections.

## Phase 2: group-scoped users (planned)
- `users.tenant_group_id` as an alternative to `users.tenant_id`: the user
  sees every tenant of the group.
- `authz.ts` resolves a user to a tenant id set once per request; all read and
  write gates check membership in that set.
- Group membership changes are admin-only because they change who can see
  what.
- The selector then lists exactly the tenants in the user's set.

## Phase 3: strict isolation (planned)
- Move tenant filtering from the individual routes into one shared query
  helper so a new route cannot forget it.
- `tenant_id NOT NULL` on sites, site groups, locations, racks and devices.
  Existing unassigned rows move into an auto-created "Internal" tenant for the
  MSP's own infrastructure.
- Names and slugs unique per tenant instead of globally.
- Catalog data (manufacturers, device types) stays global.

## Phase 4: site-to-site VPNs (planned)
- New `vpns` object with two endpoints, each on a device of a specific tenant
  (may be in different tenants).
- Visible when the viewer can see at least one endpoint. An endpoint outside
  the viewer's scope is shown as a stub (tenant + device name only).
- Shown in the topology view as a dashed edge.
