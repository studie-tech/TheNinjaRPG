# Task: Fix ReferenceError `IncreasePoolsTag` on /profile

## Goal
Resolve the server-side rendering failure on `/profile` that occurs because `IncreasePoolsTag` is referenced but never defined/exported inside `@/libs/combat/types`. The fix must ensure the profile page (and any other consumer of the combat tag schemas) can evaluate without runtime errors and that the tag system stays consistent.

## Plan
1. **Reproduce & Trace Imports**
   - Inspect `@/libs/combat/types` and any consumers (notably `drizzle/schema.ts`) for references to `IncreasePoolsTag`.
   - Confirm whether the union `AllTags` still references it or if another module imports it (possibly as a type-only dependency that survived compilation). Identify exact locations to adjust.

2. **Implement Schema Fix**
   - Depending on findings, either (a) add a proper `IncreasePoolsTag` schema (mirroring the expected behavior, likely similar to other pool-affecting buff tags) or (b) remove stray references / switch them to the existing `IncreasePoolCostTag`.
   - Keep naming consistent with existing tag patterns (lowercase `type` literal, descriptive defaults, optional pool selection, etc.).
   - Ensure any helper utilities (`tagTypes`, positive/negative classifiers, etc.) are updated if a new tag is introduced.

3. **Update Runtime Logic**
   - If the new tag represents a real combat effect, add the necessary handling inside `@/libs/combat/tags.ts` and any processors/utilities (`process.ts`, `util.ts`) so it behaves correctly (e.g., actually increasing pools or whichever mechanic is intended).
   - Keep logic parallel to existing pool-related tags to maintain consistency.

4. **Verify**
   - Run targeted type checks or unit tests if available (or minimally ensure the project compiles by running `bunx next lint` or similar lightweight command).
   - Document the change and confirm no lint errors were introduced in touched files.

## Open Questions
- Does gameplay design genuinely require a distinct `increasepools` effect (vs. cost adjustments), or should references be renamed? Need clarification from existing data or team conventions before final implementation.
