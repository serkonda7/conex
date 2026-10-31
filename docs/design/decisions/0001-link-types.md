# 0001: Three link types: in-app, external, scroll
- Date: 2026-10-31
- Status: accepted

| Type | Markup | Marker |
| --- | --- | --- |
| In-app | `<a href="/…">` | None; `→` on standalone links (in i18n string) |
| External | `<a href="https://…" target="_blank" rel="noopener noreferrer">` | `↗` (CSS) |
| Scroll | `<ScrollLink target="id">` | `↓` (`ScrollLink`) |

Links use `--link`, underlined on hover. `mailto:` and `tel:` are plain `<a>`.

- **In-app:** no click handler; the shell routes it. Use `goTo` only for options,
  a callback, or `stopPropagation`.
- **Scroll:** no plain hash links; hidden tabs can hold the same id. Set
  `scroll-margin-top: var(--topbar-height)` on the target.
- **Buttons:** links go somewhere, buttons do something. `--link` text must be
  interactive.

Exceptions:

- Sidebar, top bar, stat cards, rack blocks and floor plan markers may use their
  own styling.
- SVG floor plan areas call `goTo` from a `<g>`.
- The skip link uses `#main`.
- Links may open forms for objects without a detail page (rack shelves) and in
  hint text.
