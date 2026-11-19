# 0005: Integrations: status cards and one detail page each
- Date: 2026-11-19
- Status: accepted

**Integrations page.** Every integration, set up or not, is a card in a grid
grouped by category, with a grid / list switch (remembered per browser). The
header counts connected integrations and those needing attention. A card shows,
top to bottom:

1. Icon tile, name and a few-word description.
2. One state pill (Connected, Syncing…, Connection failed, Disabled) plus
   yellow warning pills for problems that do not break the connection.
3. When it last synced (relative, exact time on hover), or the server's error.
4. A footer with one action on the right ("Sync now", "Set up") and a link on
   the left only when something needs fixing ("Fix connection →").

The whole card opens the detail page (an unconfigured one opens its setup).
Cards have no ⋯ menu and never open a form in place. A failing card gets an
error-tinted border, a disabled one is dimmed, and one with a missing
prerequisite stays visible and says what it needs. The green primary style is
kept for the one action that matters most (e.g. "Run first sync").

**Detail page.** Every integration has one, laid out the same way:

1. A header like the card, plus an **Enabled** switch that saves at once,
   **Sync now** and a ⋯ menu for rarer actions (Force full sync). A failing
   login shows an error box with a way to the settings.
2. Tabs: the integration's data first, **Settings** last. Before setup
   Settings is the only tab. There are no separate edit pages.
3. Settings holds everything edited rather than switched (connection,
   credentials and test, sync interval) in titled sections with one Save,
   and ends with a **danger zone**: what removing deletes and keeps, and a
   Remove button.

Disabling is the everyday off switch. Removing is only offered in the danger
zone, never on a card or in a ⋯ menu.
