# Task: Fix ZodError on /profile/experience

## Goal
Ensure assigning experience on `profile/experience` no longer crashes with `ZodError` complaining that stat values must be ≥ 0.01.

## Current Understanding
- Both the client `SimpleDistribution` form and the server mutation reuse `createStatSchema` (defaulting to `min=0`, `start=0`).
- Users can submit distributions where some stats remain at `0` when they do not allocate points to them.
- Despite `min=0`, the runtime error states `minimum: 0.01`, suggesting some transformation (likely `roundStat`) or an additional schema layer enforces a `0.01` lower bound.

## Implementation Plan
1. **Inspect stat utilities**
   - Locate `createStatSchema`, `roundStat`, and any helpers (probably under `app/src/libs/profile` or `app/src/validators`).
   - Confirm whether `roundStat` or another shared helper clamps values to `>= 0.01`.
   - Trace where `SimpleDistribution` obtains defaults and how it submits to the mutation to ensure parity with backend expectations.

2. **Identify root cause & decide fix**
   - If `roundStat` enforces a `0.01` minimum, relax it to allow `0` while preserving whatever precision rules exist.
   - If another schema/version (client/server mismatch) enforces the stricter minimum, align both sides so zero values remain valid when `min=0`.
   - Ensure redistributions (where `min` might be `0.01`) are unaffected.

3. **Implement code changes**
   - Update the offending helper/schema with clear branching so when `min=0` we accept zero.
   - Keep naming/style consistent with existing profile stat components.
   - Add succinct comments if behavior differs between redistribution vs. first-time allocation.

4. **Add/adjust tests**
   - Find existing unit or integration tests around stat schemas; extend them to cover zero-value distributions when allowed.
   - If no tests exist, add a focused test for `createStatSchema` (or whichever module we touch) to lock in the new behavior.

5. **Validate locally**
   - Run focused tests (or lint if needed) to ensure no regressions.
   - Optionally simulate the schema parse (via a small script or node REPL) to prove zero values now validate cleanly.

## Open Questions / Assumptions
- Assume first-time experience allocation should accept zeroes for unassigned stats.
- Assume redistributions (if any) continue to require strictly positive numbers if that was the prior rule.
