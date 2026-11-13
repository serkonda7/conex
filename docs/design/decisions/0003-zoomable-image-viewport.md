# 0003: Zoomable images fill a fixed viewport
- Date: 2026-11-13
- Status: accepted

Images that zoom and pan (the floor plan, the attachment lightbox) share
`ZoomViewport` (`client/src/components/zoom_viewport.tsx`): zoom buttons below
the image, Ctrl + wheel and pinch to zoom, drag to pan while zoomed in.

The viewport has one of two layouts:

- **Shrink-wrapped** (the floor plan): the viewport is exactly as large as the
  image capped in height. The floor plan's toolbar and stage bar line up with the
  image, and plans are usually landscape, so they fill the space anyway.
- **Fill** (the lightbox, `fill` prop): the viewport is as wide as the frame and
  as high as the image at that width, capped at 70vh. The image is fitted
  into it and centered, never upscaled. Very narrow, tall images (rack photos)
  would otherwise become a thin strip that stays the same thin strip when zoomed
  in, panned through a slot.

Zoom and pan treat each axis on its own: while the zoomed image is smaller than
the viewport along an axis, it stays centered there; once larger, it keeps
covering the viewport. Zooming into a tall image first widens it into the empty
space and only then crops it. In the shrink-wrapped layout image and viewport
are the same size, so this is the plain "cover the viewport" rule.
