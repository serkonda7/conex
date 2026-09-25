# Navigation, breadcrumbs and tabs: review and proposal

Scope: `client/src/router.ts`, `client/src/App.tsx`, `client/src/components/detail_page.tsx`,
and how the detail, add and edit pages use them.

**Status:** proposals 1, 2, 3 and 6 are implemented (`client/src/routes.ts`, `client/src/router.ts`).
That fixes bugs 1–3. Bug 4 is partly fixed: after a delete, the object's tab now shows the list
instead of lingering, but Back still returns to the deleted object.

## How it works now

- **Sidebar:** one flat list of 13 items under "Inventory". Each item has a quick "+" button, and
  Device Types also has an import button.
- **Tabs:** "smart" tabs that stay loaded in the background. Detail pages and add/edit/import
  forms each open in their own tab. Moving from one list to another reuses the current tab. A form
  tab closes itself after save or cancel.
- **Back links and breadcrumbs:** each detail page has a `← List` link (`DetailBackLink`).
  Locations and site groups also show a one-level `parent / child` line (`ParentBreadcrumb`).

## Bugs

1. **The browser Back button breaks tabs.** Every navigation adds a browser history entry,
   including switching tabs (`activateTab` → `syncUrl`). But the `popstate` handler
   (`router.ts:328`) just rewrites the path of whichever tab is open. If you switch from tab A to
   tab B and press Back, tab B turns into a copy of A: two tabs show the same page, and Forward no
   longer makes sense.
2. **Stale tab names.** `tabLabels` is stored by tab id and never cleared. Names are only picked
   up when a tab was first opened on a detail page (`App.tsx:598`). After Back changes a detail tab
   into a list page, it still shows the old object's name. A tab that later becomes a detail page
   never gets a name.
3. **Ctrl-click on list-to-list links can take over the current tab.** `go()` in
   `list_page.tsx:31` ignores Ctrl/Cmd/Shift, so Solid's click handler navigates normally first.
   Then the page-wide `onLinkClick` runs `openInNewTab`, and because the current tab now shows that
   page, it just stays there. Only `goTo` checks for modifier keys.
4. **Deleting an object leaves its tab open.** `useDetailDelete` navigates to the list, which
   opens or refreshes a list tab. The tab for the deleted object stays open behind it and says
   "not found".
5. **Tab names are read from the page's heading.** A `MutationObserver` watches each detail page
   and grabs the first text in its `h2`. It breaks as soon as a heading's layout changes (for
   example, rack detail puts `<span>42U</span>` inside the h2), and it runs a DOM watcher on every
   open detail tab.

## Structural issues

- **Route information is repeated in 6 places:** `parseRoute` (~190 lines of near-identical
  branches), the `RouteContent` switch (~130 lines), `DETAIL_SECTIONS`, `SECTION_ENTITIES`, the
  `NavItem` list with hand-written `startsWith` checks, and each page's `backTo`. Adding a new
  entity means editing all of them.
- **There are three click helpers that behave differently:** `go` in `list_page.tsx`, `goTo` in
  `router.ts`, and a wrapper `go` in `App.tsx`.
- **Tabs aren't saved.** Reloading the page keeps only the current URL; every other tab is lost.

## UX issues

- **Too many tabs.** Every detail-to-detail click opens a new tab (the `activeIsLeaf` rule).
  Going Rack → Device → Site → Tenant leaves four tabs, and a tab has no Back of its own.
- **Breadcrumbs don't show where an object sits.** Only the self-parent chain appears, and only
  one level of it. A device doesn't show Site › Location › Rack. The back link and the parent line
  are two separate, stacked elements.
- **Edit tabs show ids, not names**, e.g. "Edit Device 12". The tab tooltip shows the raw path.
- **Sidebar:**
  - There's no grouping; NetBox uses sections like Organization / Racks / Devices / Connections /
    Admin.
  - Interfaces, Connections and Topology show disabled "+" buttons that are only noise.
  - The logo links to `/tenants`.
- **Accessibility:**
  - Tabs have no `aria-controls` link to their content, and the content areas have no
    `role="tabpanel"`.
  - Every tab can be reached with Tab (`tabIndex=0` on all of them) instead of arrow keys moving
    between tabs.
  - There are no keyboard shortcuts to close or switch tabs, and no "close others" option.
  - The tab bar just scrolls sideways when it fills up.

## Proposed changes (in priority order)

1. **Build everything from one route table**, e.g. in `routes.ts`:

   ```ts
   { section: 'devices', entity: 'entity.device', icon: IconServer, group: 'devices',
     list: DevicesPage, detail: DeviceDetailPage, add: DeviceAddPage, edit: DeviceEditPage,
     adminOnly?: boolean, aliases?: ['cables'] }
   ```

   The route parser, page switch, detail check, tab titles, sidebar highlighting and grouping all
   come from this table. That replaces roughly 400 lines and makes bugs of the "forgot one list"
   kind impossible.
2. **Give each tab its own history.** Each tab keeps its own back/forward list. Browser Back and
   Forward move through the current tab's list. Switching tabs replaces the history entry instead
   of adding one. This fixes bugs 1 and 2 and lets detail-to-detail clicks stay in the same tab.
3. **Change the tab-opening rules:**
   - Plain click on a detail link → same tab, adding to that tab's history.
   - Ctrl-click or middle-click → new tab.
   - Forms still open in a new tab and close on save.

   This stops the pile-up of tabs.
4. **Let pages report their own names and breadcrumbs.** Instead of reading the heading, each
   detail page registers its data once it loads, e.g.
   `useTabMeta({ label: device()?.name, crumbs: [...] })`. That removes the DOM watcher, fixes
   names on edit tabs ("Edit sw-core-01"), and gives the breadcrumb bar its data.
5. **Add a proper breadcrumb bar.** Replace both `DetailBackLink` and `ParentBreadcrumb` with one
   `<nav aria-label="breadcrumb">` showing the full chain, e.g.
   `Devices › DC1 › Room A › Rack 03 › sw-core-01`. Edit pages add `› Edit`. The first link
   replaces the `← Devices` link.
6. **Use one click helper.** Keep `goTo` (it handles modifier keys), delete the two `go`
   helpers, and have the page-wide link handler skip clicks that are already `defaultPrevented`.
7. **Close the deleted object's tab** when a delete succeeds, then focus the tab that opened it
   or the list tab.
8. **Save tabs in `sessionStorage`**: paths, the active tab and each tab's history, so a reload
   brings them back.
9. **Tab bar improvements:**
   - Proper ARIA roles and arrow-key movement.
   - Keyboard shortcuts to close a tab and move to the next or previous one.
   - A right-click menu with Close others / Close to the right / Duplicate.
   - A dropdown listing all tabs when they don't fit.
   - An icon for each type of object on its tab (from the route table).
10. **Sidebar:** group the items into collapsible sections, hide "+" where there's no add page,
    and let the logo go to a home page.

## Suggested order

Items 1, 2, 3 and 6 build on each other and are where most of the value is. Items 4 and 5 then
depend on them. Do them as one refactor, then add the breadcrumbs and tab-bar polish separately.
The existing e2e selectors would stay the same; `detail_page.tsx` notes the pages keep their DOM
stable for them.

## Open questions

- Is the switch in item 3, where plain clicks on detail links stay in the same tab, acceptable?
  It changes the current "every object gets its own tab" behavior.
- Should the work start with the route-table refactor?
