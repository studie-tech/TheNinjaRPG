# Plan: Fix /register hook mismatch caused by carousel controls

## Goal
Keep the carousel navigation controls mounted so the number/order of hooks invoked inside the `/register` tree stays constant, eliminating the "Rendered more hooks" crash while preserving the existing UX.

## Steps
1. **Re-review carousel implementation**  
   - Inspect `app/src/components/ui/carousel.tsx` to confirm that `CarouselPrevious`/`CarouselNext` call `useCarousel()` (which itself calls React's `use` hook) before returning `null` when scrolling isn't allowed.  
   - Verify no other components rely on these controls conditionally unmounting (grep for `CarouselNext` usage; currently only `/register`).

2. **Keep nav buttons mounted**  
   - Remove the early `return null` branches in both nav components so the hook order inside those components never depends on scroll state.  
   - Introduce an `isDisabled` flag derived from `canScrollPrev/Next` and apply it to `disabled`, `aria-disabled`, and CSS (`opacity-0 pointer-events-none` etc.) to hide the buttons visually when scrolling isn't possible.  
   - Optionally allow passing custom `disabledClassName` via existing `className` prop so existing call sites remain stylistically consistent.

3. **Propagate consistent styling**  
   - Ensure the buttons retain their current placement (`absolute left-2/right-2 ...`) and animation classes, so `/register` doesn't change layout when controls are disabled.  
   - Confirm other props continue to work (e.g., additional classes from call sites stack after the built-in classes).

4. **Validate**  
   - Rerun lightweight checks (TypeScript typecheck via `bunx tsc --noEmit` or rely on editor diagnostics) focusing on `app/src/components/ui/carousel.tsx` and `/register`.  
   - Manually reason that the buttons stay mounted and the Embla carousel keeps the same DOM subtree, preventing the `removeChild` errors reported in Sentry.

## Notes
- Because only `/register` uses these carousel controls, the change will not impact other routes.  
- No API/schema updates are needed; this is a purely client-side fix.
