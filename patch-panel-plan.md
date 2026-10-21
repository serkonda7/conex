# Patch panels: implementation plan

Tracks [#39](https://github.com/serkonda7/conex/issues/39): front ports (incoming),
rear ports (outgoing) = wall outlets, rear ports on the floor plan, cables
considered individually (no logical grouping as an outlet).

## Decisions

1. Port names are unique per **(device, side)**: a normal port, front port `1`
   and rear port `1` may coexist on one device.
2. Floor-plan candidates are rear ports of panels within the plan owner's **site**.
3. **Multi-position rear ports are in scope** (NetBox model).
4. **No conversion** of existing panel devices; recreate them from new templates.

## Data model (migration `0039_patch_panel_ports.sql`)

### `interfaces`

- `side`: `NULL` (normal port) | `'front'` | `'rear'`.
- `positions`: integer, default 1, minimum 1; above 1 only on rear ports
  (check constraint).
- `rear_port_id` + `rear_port_position`, front ports only (check constraint):
  - `rear_port_id` is a self-reference to a rear port on the same device
    (service layer).
  - The position must be between 1 and that rear port's `positions`.
  - `(rear_port_id, rear_port_position)` is unique: each slot of a rear port
    has at most one front port. Empty slots are allowed.
- Unique index `(device_id, name)` becomes
  `(device_id, side, name) NULLS NOT DISTINCT` (Postgres 17, drizzle
  `.nullsNotDistinct()`).

### `device_type_interfaces` (template stubs)

- `side` and `positions` (rear stubs).
- `rear_stub_id` + `rear_position` (default 1) on front stubs.
- Expansion when a device is created:
  - A rear stub with count R and P positions gives R×P slots in order: rear 1
    positions 1..P, then rear 2, and so on.
  - Front port *i* (counting from 0) of a front stub takes slot
    `(rear_position − 1) + i`, which maps to rear port `slot ÷ P` (rounded
    down), position `slot mod P + 1`.
  - Saving a template is rejected if a front stub doesn't fit or two front
    stubs overlap.
  - Covers a 24-port copper panel (24 front ↔ 24 rear, P = 1), a 12-port MPO
    cassette (12 front ↔ 1 rear with P = 12), and the YAML import, where each
    port becomes a single-port stub with an explicit position.
- Unique index `(device_type_id, prefix, kind)` gets `side` added.

### `floorplan_placements`

- New column `interface_id` (unique, cascade on delete).
- Check becomes "exactly one of rack / device / interface".
- The service layer only accepts rear ports with `positions = 1`. A
  multi-position rear port is a trunk between panels, not an outlet.

### Device roles

- Built-in `patch-panel` role key with the `patch-panel` icon (same approach
  as migration 0037). Only a convenience: behaviour depends on whether a port
  has `side` set, not on the role.

### `shared/src/schemas.ts`

- `PORT_SIDES`, and new fields on `InterfaceJson` and the stub create/update
  schemas.
- Placement and candidate JSON (`FloorplanPlacementJson/Put`,
  `FloorplanCandidateJson`) carry the port.
- Validation: `positions` only on the rear side, `rear_*` only on the front
  side.

## Lookups by name (these now need the side)

- **`server/src/db/devices.ts` (port name taken check):** checks the side as
  well.
- **Cable CSV import/export (`server/src/db/csv_transfer.ts`):**
  - New optional `a_side` / `b_side` columns (`front` | `rear` | empty),
    similar to NetBox's termination type.
  - Import: a name that exists on more than one side without a side given is
    rejected with "ambiguous; set a_side".
  - Export always fills the side columns.
- **Interface CSV:** gets `side`, `positions`, `rear_port` and
  `rear_port_position` columns.
- **Template expansion:** name-clash checks compare per side.

## Cabling rules (`server/src/db/cables.ts`)

- Front and rear ports are ordinary cable endpoints: one cable each, with the
  existing kind-compatibility rules.
- Typical use: switch port → front port, rear port (= the outlet) → end
  device, rear ↔ rear between panels = trunk.
- A cable from a port to another port of the same pass-through group on the
  same panel is rejected.

## Trace (`server/src/db/trace.ts`), NetBox-style position tracking

- The graph is built per port, plus pass-through edges inside each panel.
- The walk carries a **stack of positions**:
  - Arriving on a front port: push its `rear_port_position` and continue
    through its rear port.
  - Arriving on a rear port with a non-empty stack: pop the position and
    continue through the front port mapped to that slot.
  - Arriving on a rear port with an empty stack:
    - P = 1: continue through the one front port.
    - P > 1: **split** into one path per mapped front port; those paths are
      marked `split: true` (as in NetBox).
- Data: `TraceHop` gets `pass_through` hops (or the paired port in
  `from_interface`), `TracePath` gets `split`. `MAX_TRACE_PATHS` and tenant
  scope filtering stay as they are.
- New output: an **end-to-end peer** per port, e.g.
  "→ PC-123 via PP-A 12 · PP-B 12".

## Floor plan

- **Candidates** (`listPlanCandidates`): unplaced single-position rear ports
  of panels in the owner's site, labelled `PP-A / 12`.
- **One marker per rear port**, no grouping into an outlet. Socket glyph;
  colour shows whether the port is cabled.
- **"Place in sequence" mode:** each click places the next free rear port of
  the chosen panel.
- **Marker popover:** the trace (switch port ↔ panel(s) ↔ end device) and a
  connect action.
- **Device detail of an end device:** "Outlet: PP-A / 12 (plan X)" for each
  port cabled to a placed rear port.

## UI

- **Device type editor:**
  - Side selector on each stub; positions for rear stubs; rear stub + start
    position for front stubs.
  - Quick-add presets "patch panel N ports" (N:N) and "cassette N × MPO"
    (N:1×N).
- **Device detail for panels:** ports grouped by rear port.
  - P = 1: one row per pair, `# | Front → peer | Rear (outlet) → peer | plan`.
  - P > 1: a rear port row with its position rows (front ports) nested
    underneath.
  - Connect/disconnect on each side.
- **Connect dialog:** side badges on tiles; front/rear groups when a panel is
  the peer device.
- **Labels:** new strings get keys in `client/src/i18n/en.ts` and `de.ts`;
  side display values go in `client/src/i18n/labels.ts`.

## Import

- **NetBox YAML** (`server/src/db/csv_transfer.ts`):
  - `rear-ports: [{name, type, positions}]` and
    `front-ports: [{name, type, rear_port, rear_port_position}]`.
  - `rear_port` is looked up by name among the rear ports of the same
    document.
  - `type` (`8p8c`, `lc`, `mpo`, …) is stored as `kind`.
- **Field table and AI prompt** in `client/src/pages/device_types/import.tsx`:
  both updated.

## Phases (one commit each)

1. Schema, template stubs and expansion, name/side uniqueness and lookups,
   CSV side columns, YAML import, device detail panel view.
2. Trace with position stack and split paths; end-to-end peer display.
3. Rear ports on the floor plan: candidates, markers, sequence placement,
   outlet hint on end devices.

Existing e2e tests for traces, floor plans, YAML import and cable CSV need
updating per phase. New tests only after confirmation (AGENTS.md).

## Open question

- Connector kind compatibility: should kinds like `lc` and `mpo` connect only
  to their own kind (as display ports do today)? Answer: yes, same kind only.
