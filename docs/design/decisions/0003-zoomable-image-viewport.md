# 0003: Zoomable images use `ZoomViewport`
- Date: 2026-11-13
- Status: accepted

Every image that zooms and pans (the floor plan, the attachment lightbox, any
future one) uses `ZoomViewport` (`client/src/components/zoom_viewport.tsx`),
never its own pan/zoom. So every zoomable image behaves the same: zoom buttons
below the image, Ctrl + wheel and pinch to zoom, drag to pan while zoomed in.

How the viewport sizes and fits the image is documented in the component.
