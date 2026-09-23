# Client refactoring review — share more code

## 1. API layer (`client/src/api_*.ts`)

- `Page<T>` defined 4x identically: `client/src/api_p1.ts:11`, `client/src/api_p2.ts:12`, `client/src/api_p3.ts:11`, `client/src/api_p4.ts:11`. `client/src/api_p5.ts:10` imports from `api_p4`, `client/src/api_users.ts:9` from `api_p1`. Move to `shared/src/types.ts`.
- `getPage<T>` copy-pasted 4x: `client/src/api_p1.ts:23`, `client/src/api_p2.ts:21`, `client/src/api_p3.ts:20`, `client/src/api_p4.ts:20`. `api_p5` / `api_users` inline the same `to_result<Page<...>>` call. Single helper in `client/src/api.ts` plus `to_query()` for `String(filters.x ?? ...)` coercion fixes query-string boilerplate in ~20 list functions (`client/src/api_p1.ts:38-45`, `client/src/api_p2.ts:63-72`, `client/src/api_p4.ts:44-54`, etc.).
- ~50 CRUD functions share the same 3 lines (`client.<entity>[':id'].$patch...` + `to_result`). `delete_*` repeats 11x, `fetch_*_by-id` 10x with only `String(id)` + fallback noun changed.
- Raw `fetch` in `client/src/api_auth.ts:40-56,90-106` and `client/src/api_p6.ts:37-71` duplicates `try/catch + read_api_error` instead of using `to_result` in `client/src/api.ts:38-49`, missing 401 → `unauthorized_handler`. Add `post_json<T>(url, body, fallback)` wrapper.
- `fetchProviders` / `fetchSetupStatus` / `fetchMe` in `client/src/api_auth.ts:13-87` return `undefined` / `null` sentinels vs `Result` convention — callers can't distinguish 500 vs network-down.

## 2. Client types duplicating `shared/`

- `*CreateInput` / `*UpdateInput` / `*Filters` / `*Sort` mirror shared schemas: `client/src/api_p1.ts:51-66,90-141`, `client/src/api_p2.ts:32-58`, `client/src/api_p3.ts:31-76,98-173`, `client/src/api_p4.ts:27-97`, `client/src/api_users.ts:15-64`. Replace with `TenantCreate` / `TenantUpdate` / `TenantListQuery`, `DeviceCreate` / `DeviceUpdate`, `UserCreate`, etc. from `shared/src/schemas.ts`.
- Literal unions re-declared ~10x: `order?: 'asc' | 'desc'`, `role: 'admin' | 'editor' | 'viewer'` (`client/src/api_auth.ts:61`, `client/src/pages/user_add.tsx:17`, `client/src/pages/user_edit.tsx:14`, `client/src/App.tsx:1041`), `DeviceStatus` (`client/src/api_p4.ts:34`), `CableStatus` (`client/src/api_p5.ts:17`), `DeviceFace` (`client/src/components/rack_elevation.tsx:5-7`), `form_factor` / `width` (`client/src/api_p3.ts:136-142`). Import `Role` / `DeviceStatus` / `CableStatus` / `DeviceFace` from shared.
- `SessionUser` in `client/src/api_auth.ts:59-63` should be `UserJson['role']` like `client/src/api_users.ts:13` already does.
- Row types imported from `server/src/db/*` in `api_p1`, `api_p2`, `api_p3`, `api_p4`, `api_p5` violate the monorepo boundary; expose via `shared/` like `TopologyResponse` / `ImportResponse` / `UserJson` already do. `SiteGroupRow` in `client/src/api_p1.ts:307-315` is hand-defined while siblings import from server — inconsistent.
- `shared/src/types.ts:3-34` barrel is stale (only P0–P2 subset). Forces mixed imports from `schemas` vs `types`. Re-export everything, standardize client on one entrypoint.

## 3. Pages / components (~2,500 lines cloneable)

- List pages (9 near-clones: `sites.tsx`, `devices.tsx`, `tenants.tsx`, `racks.tsx`, etc.): `go(e, to)` (~20 files, belongs in `router.ts`), 250ms search debounce (~15 lines × 12), sort toggle, `selected: number[]` + `DataTable` wiring, `use_visible_columns`, `RowMenuAnchor` / `toggleMenu` (~50 lines × 9), Portal menu chrome (~60 lines × 9), `handleDelete` / `handleBulkDelete` (~35 lines × 9). Extract `components/list_page.tsx`: `ListPageShell` + `useDebouncedSearch` / `useSort` / `useSelection` / `useRowMenu` / `useDeleteItem`.
- Edit pages (9x, `*_edit.tsx`): hand-roll what add pages already share via `components/form.tsx` + `util/form.ts`. `client/src/pages/site_edit.tsx:73-107`, `client/src/pages/tenant_edit.tsx:40-68`, `client/src/pages/device_edit.tsx:117-150` share an identical validate-trim-save flow; `div class="field"` repeated 2–10x per file. Add `EditPageShell` / `EditActions` / `useEditForm`, migrate to `NameField` / `SlugField` / `TextField` / `SelectField` / `FormError`.
- Detail pages (8x): back-link + `Show loading/empty` + `page-header` + `detail-grid` + `handleDelete -> navigate(list)` identical. FK link pattern (`createMemo` + `createResource` + triple-nested `Show`) ~20 lines × ~25 FKs (~500 lines, e.g. `client/src/pages/site_detail.tsx:105-128`, `client/src/pages/device_detail.tsx:93-143`). Extract `DetailPageShell` + `DetailGrid` + `ForeignKeyLink` + `RelatedSection`.
- Feedback: `skeleton` (~30x), `empty` (~25x), `app-inline-error` (~40x). Single `components/feedback.tsx`: `Loading` / `Empty` / `InlineError`.
- `ObjectSelector` used once (`client/src/pages/rack_detail.tsx:396-408`); everywhere else `SelectField` + `row_options()` breaks past ~50 options and duplicates the site → location cascade (`client/src/pages/device_add.tsx:81-92`, `client/src/pages/device_edit.tsx:47-57`). Add `SelectorField` wrapper, keep `SelectField` for tiny enums only.

## Suggested order

1. `Page` / `getPage` / `to_query` + shared barrel
2. `post_json` wrapper
3. List-page shell
4. Edit / detail shells
5. `Create` / `Update` / `ListQuery` type swap
