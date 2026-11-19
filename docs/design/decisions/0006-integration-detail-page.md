# 0006: One detail page per integration
- Date: 2026-11-19
- Status: accepted (replaces the card click, footer link, inline settings
  form and ⋯ Delete of 0005; the card ⋯ menu is removed by 0007)

Every integration has its own detail page, laid out the same way for all of
them (TANSS at `/integrations/:id`, the calendar sync at
`/integrations/calendar-sync`):

1. A header with the icon tile, name and description, the status pills and
   the last sync line (as on the card). Once set up, the right side holds an
   **Enabled** switch that saves at once, **Sync now** and the ⋯ menu for rarer
   actions (e.g. Force full sync). A failing login shows its message in an
   error box under the header with a way to the settings.
2. Tabs below the header. First the integration's data: the consistency
   report and the link boards for TANSS, the technician mapping for the
   calendar sync. **Settings** comes last.
3. The Settings tab holds everything that is edited rather than switched:
   connection and credentials with the connection test, and the sync
   interval where the integration runs on a schedule, in titled sections
   with one Save. Before setup it is the only tab.
4. Settings ends with a **danger zone**: what removing deletes and what
   stays, and a Remove button. Every integration can be removed this way.
   Disabling is the everyday off switch. Removing is never offered on a card
   or in a ⋯ menu.

On the integrations page the whole card opens the detail page (an
unconfigured card opens its setup). Buttons and links on the card keep
their own action. Cards have no ⋯ menu (0007): **Settings** and Force full
sync are reached from the detail page. The footer link only appears when something needs fixing
("Fix connection →" to the Settings tab), and no card opens a form in place.
There are no separate edit pages for integrations.
