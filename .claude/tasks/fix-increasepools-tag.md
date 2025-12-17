# Fix IncreasePoolsTag ReferenceError

## Context
- Visiting `/profile` triggers Next.js to import `@/libs/combat/types` via `drizzle/schema`.
- Module evaluation fails because `AllTags` references `IncreasePoolsTag` (and possibly `DecreasePoolsTag`) that have no corresponding schema definitions.
- We need to either reintroduce the missing tag definitions or remove the stale references so the module can load.

## Plan
1. **Inspect combat tag schemas**
   - Open `app/src/libs/combat/types.ts` and locate the `AllTags` union plus nearby tag definitions.
   - Confirm whether `IncreasePoolsTag` / `DecreasePoolsTag` definitions exist, and note any adjacent code that might expect them.

2. **Search for usage of the missing tags**
   - Search the codebase (combat logic, utilities, data files) for strings like `increasepools` / `decreasepools` to understand whether these effects should exist.
   - This informs whether we should remove the references or add proper schemas plus supporting logic.

3. **Implement the appropriate fix**
   - If no usages exist, remove the undefined tags from `AllTags` and any other exports so the union only references defined schemas.
   - If usages exist, create `IncreasePoolsTag` and `DecreasePoolsTag` schema definitions (modeled after similar pool-related tags), export them, and include them in `AllTags`. Update any supporting logic (`tags.ts`, `util.ts`, positive/negative helpers) so they behave correctly.

4. **Validate type safety and runtime**
   - Run a targeted type check (e.g., `bunx tsc --noEmit`) to ensure there are no remaining reference errors.
   - Optionally hit `/profile` or run relevant unit tests if available to ensure the server starts cleanly.

5. **Document outcome**
   - Summarize the chosen fix in the final response, noting any follow-up risks (e.g., if the tags were removed rather than implemented).

## Reasoning
- Steps 1–2 ensure we understand the existing state and avoid unintentionally breaking gameplay logic.
- Step 3 adapts based on findings, preventing another ReferenceError while preserving intended features.
- Step 4 provides confidence that the module now evaluates successfully.
- Step 5 communicates the resolution clearly for future maintainers.
