# Task: Fix hook ordering issue on /profile

## Goal
Resolve the "Rendered more hooks than during the previous render" error on the `/profile` page. Prevent `capUserStats` from mutating `userData` during render, ensure stat normalization respects Zod constraints, and confirm the profile view renders reliably.

## Plan
1. **Baseline reproduction & tracing**
   - Load `/profile` in dev server to reproduce the hook mismatch and capture stack traces.
   - Inspect console/log output to correlate with Zod validation failures.

2. **Code investigation**
   - Review `useRequiredUserData` consumer components in `/app/src/app/profile` and related layout files.
   - Inspect `StrengthWeaknesses` component and supporting utilities (likely under `app/src/app/profile/_components/...`).
   - Examine `capUserStats` implementation to confirm mutation behavior and locate call sites.

3. **Design a safe stat-normalization flow**
   - Decide between cloning `userData` before mutation or performing capping inside `useMemo`/`useEffect` that owns its own state.
   - Ensure derived stats respect the >= 0.01 constraint before validation.
   - Outline how to avoid conditional hooks (e.g., by guarding rendering with early returns or using optional chaining only).

4. **Implement fixes**
   - Refactor `StrengthWeaknesses` (or whichever component calls `capUserStats`) to compute capped stats immutably.
   - If stat capping needs to persist to the server, move the mutation into an explicit mutation handler; otherwise only use derived data for display.
   - Add defensive helpers (e.g., `normaliseStat(statsField)`), ensuring they live near existing utilities per repo conventions.

5. **Validation and testing**
   - Run relevant unit/component tests if available (likely `bun test` or targeted vitest files).
   - Manual verification: reload `/profile`, switch tabs, ensure no hook errors or Zod complaints in console.

6. **Documentation & cleanup**
   - Add concise comments if logic requires clarification.
   - Update TODO/task file with work log once implementation completes.
