# Fix prevTabRef ReferenceError on /jutsus

## Context
- Navigating to `/jutsus` renders `MyJutsu`, which includes the `Countdown` component for free transfer resets.
- Fast Refresh or prop changes trigger `Countdown` to mutate `useRef` values during render, and minified output misorders declarations, leading to `ReferenceError: prevTabRef is not defined`.
- We need to ensure refs are initialized and mutated only inside React effects so React can safely re-run renders.

## Plan
1. **Audit `Countdown` state + refs**
   - Confirm current refs (`prevTargetTimeRef`, `hasCalledOnFinishRef`, `onFinishRef`) and how they reset when `targetDate` changes.
   - Identify the exact render-phase mutations that could confuse Fast Refresh.
2. **Refactor ref-reset logic into effects**
   - Memoize `targetTime` to avoid recomputation thrash.
   - Use `useEffect` to watch `targetTime` and reset `prevTargetTimeRef`/`hasCalledOnFinishRef` there instead of inside render.
   - Ensure `onFinishRef` stays in sync without causing extra renders.
3. **Harden countdown ticking logic**
   - Keep a single interval effect depending on `targetTime`; ensure cleanup and guard against stale closures.
   - Add early exit when countdown already finished on mount.
4. **Verify behavior manually**
   - Build/refresh the page to ensure no runtime ReferenceError occurs when toggling tabs.
   - Ensure countdown still updates and triggers `onFinish` exactly once.

## Testing
- Manual: load `/jutsus`, observe countdown updating, trigger tab toggles/refresh to confirm no errors in console.
