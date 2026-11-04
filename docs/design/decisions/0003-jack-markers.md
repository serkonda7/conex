# 0003: A jack is one floor-plan marker
- Date: 2026-11-04
- Status: accepted

Outlets (single-position rear ports) of a patch panel can be grouped into a
jack, e.g. a double jack with two ports. On floor plans the jack replaces its
ports:

- **Marker:** one outlet marker, widened to hold one socket glyph per port.
  Each socket is green when its port is cabled, muted when free. The marker
  border turns green only when every port is cabled.
- **Tooltip:** "Jack, 1 of 2 ports cabled" instead of "Outlet, cabled/free".
- **Popover:** one section per port, headed by the port name, with its panel
  and outlet side and its own connect button.
- **Palette:** a jack is one item in the panel's outlet group, with the same
  socket glyphs; sequence placement places it as one step.
