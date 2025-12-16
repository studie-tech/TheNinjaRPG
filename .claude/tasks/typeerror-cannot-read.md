# Plan: Fix Cytoscape drag emit crash

## Context
- `GraphUsersGeneric` destroys the Cytoscape core during `useEffect` cleanup.
- When the component unmounts mid-drag (or rerenders while Cytoscape is mid-gesture), Cytoscape still tries to emit `free`/`dragfree` on the dragged collection, but the core has already been destroyed, producing `TypeError: Cannot read properties of undefined (reading 'emit')`.

## Implementation Steps
1. **Track drag lifecycle**
   - Add `isDraggingRef` to know when a drag gesture is active, plus `pendingDestroyRef` + `destroyTimeoutRef` to coordinate deferred cleanup.
   - Introduce memoized `handleDragStart` / `handleDragEnd` callbacks that update refs and, on drag end, flush any deferred destroy work.

2. **Centralized teardown helper**
   - Create a `destroyInstance` utility (inside the component) that removes listeners, clears timers, and safely calls `destroy()` only if the core still exists. This helper will be reused from both the cleanup effect and drag-end handler to avoid duplication.

3. **Stabilize Cytoscape initialization**
   - Update `setCytoscape` to:
     - Destroy any stale instance before swapping.
     - Attach the new drag handlers via `on("grab"|"free"|"dragfree", ...)`, ensuring we `off` first to prevent duplicate bindings on re-render.
     - Persist the reference in `cy.current` only after listeners are bound.

4. **Deferred cleanup on unmount**
   - In the `useEffect` cleanup:
     - If no drag is active, invoke `destroyInstance` immediately.
     - If a drag is active, store the instance in `pendingDestroyRef` and schedule a fallback `setTimeout` (e.g., ~500ms) that triggers `destroyInstance` once the drag finishes or the timeout elapses, whichever happens first. This prevents Cytoscape from being torn down while it still expects to emit drag events.

5. **Manual verification plan**
   - Scenario A: open `/username/:username`, switch to the "Graph" tab, interact with the graph (drag) and quickly leave the tab — confirm no TypeError in the console/Sentry.
   - Scenario B: perform repeated highlight searches that trigger re-renders while dragging to ensure Cytoscape remains stable and listeners arent duplicated.

## Reasoning Notes
- Deferring destruction keeps Cytoscape alive until it finishes dispatching drag events, eliminating the race that produced `draggedEles` being undefined.
- Centralized helpers and listener hygiene minimize the risk of memory leaks while still guaranteeing cleanup via the timeout fallback.
