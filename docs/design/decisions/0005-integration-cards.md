# 0005: Integrations as status cards
- Date: 2026-11-19
- Status: accepted

The integrations page lists every integration, set up or not, as a card in a
responsive grid, grouped under a category heading (PSA & ticketing,
Calendar, …). The header shows how many integrations are connected and how
many need attention, and a grid / list switch (remembered per browser). The
list layout shows the same parts as one row per integration in a shared box
per category, with the ⋯ menu at the end of the row.

Every card has the same anatomy, top to bottom:

1. Icon tile, name, a short one-line description (a few words, no
   sentence about the vendor) and, once set up, the ⋯ menu.
2. Status pills: one state pill (Connected, Syncing… with a pulsing dot,
   Connection failed, Disabled), plus yellow warning pills for problems
   that do not break the connection (e.g. "Last sync failed").
3. A muted line with when it last synced (relative, exact time on hover),
   not what the sync covered. Errors show the server's message in the
   error color.
4. A footer with the main link on the left (the report or mapping page;
   "Fix connection →" while the login fails) and one action on the right
   ("Sync now", or "Set up" before setup).

Rarer actions (Edit, Force full sync, Delete) live in the ⋯ menu, never as
a row of buttons. "Set up" is a secondary button; the green primary style is
kept for the one action that matters most, such as "Run first sync" on an
integration that has never synced.

A failing card gets an error-tinted border and a disabled one is dimmed
but stays in place. A card whose prerequisite is missing (the calendar sync
without TANSS) stays visible and says what it needs instead of hiding.
A settings form opened from a card replaces the card's body and spans the
whole grid row.
