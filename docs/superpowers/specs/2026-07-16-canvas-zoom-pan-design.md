# Canvas zoom & pan

**Date:** 2026-07-16
**Status:** Approved

## Problem

The workflow canvas ([frontend/src/components/Canvas.tsx](../../../frontend/src/components/Canvas.tsx)) has no zoom or pan — nodes sit at raw pixel coordinates inside a fixed viewport (`overflow: hidden`). As workflows grow, the canvas gets crowded (nodes packed too close together at a fixed scale) and large workflows can place nodes off-screen with no way to reach them. This covers both problems: zoom to fit more on screen, pan to reach anything placed outside the current view.

## Scope decisions

- **Interaction model:** mouse wheel zooms (centered on cursor), dragging empty canvas space pans. No dedicated UI chrome for the core gesture — matches Figma/n8n/most node editors.
- **Persistence:** zoom/pan is transient UI state, not saved with the workflow. Every workflow opens at 100% zoom, origin pan. No store/schema/backend changes.
- **Reset control:** a small button showing the live zoom percentage (e.g. "85%"), clickable to reset to 100%/origin — the only visible UI addition.

## Approach

CSS transform on the existing rendering layers. Node coordinates (`node.x`, `node.y`) stay exactly as they are today — "world space," untouched by zoom. `#svg-layer` and `#nodes-layer` both receive the same inline transform:

```ts
{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, transformOrigin: '0 0' }
```

`Node.tsx` and `Connections.tsx` need **zero changes** — the browser scales the whole rendered layer uniformly, including SVG connection lines/strokes. Only `Canvas.tsx`'s mouse-event math changes, since it's the only place that converts screen coordinates to node coordinates.

Considered and rejected:
- **Recompute scaled pixel positions in JS** (multiply x/y/width/height by zoom on every render) — touches `Node.tsx`, forces full re-render of every node per zoom tick instead of a cheap repaint, needs manual crispness handling for text/borders. No benefit over the CSS transform.
- **Swap in a node-editor library** (e.g. React Flow) — gets zoom/pan/minimap for free but is a full rewrite of `Canvas.tsx`/`Node.tsx`/`Connections.tsx` and their store integration. Far past the size of this problem; discards working code.

## Design

### State

New local state in `Canvas.tsx`, alongside the existing `dragPreview` state — not in the shared `useWorkflow()` store:

```ts
const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
```

`zoom` is a multiplier (1 = 100%), clamped to **0.25–2** (25%–200%). Nothing persists; a fresh mount (or workflow switch) starts at `{ zoom: 1, panX: 0, panY: 0 }`.

### Zoom (wheel)

Native `wheel` listener on `#canvas-wrap`, attached the same way the existing `mousemove`/`mouseup`/`keydown` listeners are (via `document.addEventListener` in the main `useEffect`), with `{ passive: false }` so `preventDefault()` blocks page scroll — React's synthetic `onWheel` is passive by default and can't do this reliably.

```ts
const factor = Math.exp(-e.deltaY * 0.001);
const newZoom = clamp(view.zoom * factor, 0.25, 2);
// keep the world point under the cursor fixed while zoom changes
const newPanX = mouseX - (mouseX - view.panX) * (newZoom / view.zoom);
const newPanY = mouseY - (mouseY - view.panY) * (newZoom / view.zoom);
setView({ zoom: newZoom, panX: newPanX, panY: newPanY });
```

### Pan (drag empty canvas)

New `panningRef` (same pattern as the existing `draggingRef`/`connectingRef`). Mousedown directly on `#canvas-wrap` itself (`e.target === wrapRef.current`, i.e. not a node or port) starts a pan. The existing global `onMouseMove`/`onMouseUp` handlers gain a branch: if `panningRef.current`, update `panX`/`panY` by the mouse delta; clear it on mouseup.

### Coordinate conversion

Every place that currently turns `clientX/clientY` into a node-space coordinate — `startDrag`, the drag branch of `onMouseMove`/`onMouseUp`, `startConnect`, and `onDrop` — must go through the inverse transform instead of the current raw `clientX - rect.left`:

```ts
const worldX = (e.clientX - rect.left - view.panX) / view.zoom;
const worldY = (e.clientY - rect.top - view.panY) / view.zoom;
```

This is the only real logic change; everything downstream (dispatching `MOVE_NODE`, `ADD_NODE`, etc.) already just consumes x/y and is untouched.

### Reset / zoom-readout control

New `ZoomControl.tsx` (small, single-purpose, following the same convention as `Resizer.tsx`). Absolutely positioned bottom-right inside `#canvas-wrap`. Shows `${Math.round(view.zoom * 100)}%`; click resets `view` to `{ zoom: 1, panX: 0, panY: 0 }`.

## Edge cases

- **Pan vs. click-to-cancel-connect:** today, clicking empty canvas while `connectingFrom` is set dispatches `CANCEL_CONNECT`. A pan is a mousedown-drag-mouseup on that same element, and browsers still fire a trailing `click` after mouseup regardless of movement in between. Unguarded, panning while mid-connect would also cancel the connection. Fix: track whether the pan gesture moved more than ~4px in `panningRef`; only let the existing `onClick` cancel-connect handler fire if no real pan occurred.
- **Zoom bounds:** clamped 0.25–2 so scroll can't shrink nodes to unreadable or blow them up past usefulness.
- **New-node drop while zoomed/panned:** `onDrop`'s coordinate math goes through the same inverse-transform helper as dragging, so nodes dropped from the palette land under the cursor correctly at any zoom/pan.

## Testing

No test framework exists in `frontend/` (`package.json` only has `vite`/`tsc`/`oxlint` scripts). Verified manually via Playwright once implemented:
- Add a few nodes, scroll to zoom, confirm visual scale and cursor-anchoring
- Drag empty canvas, confirm pan
- Drag a node at non-100% zoom, confirm it lands where dropped
- Start a connection, pan, confirm the connection isn't cancelled
- Click the reset control, confirm it returns to 100%/origin
