# Fix IncreasePoolsTag ReferenceError

## Context
The `/profile` route crashes during SSR because `src/libs/combat/types.ts` references `IncreasePoolsTag` and `DecreasePoolsTag` inside the `AllTags` union even though these tag schemas are never defined/imported. We need to investigate the intended tag names or definitions and update the combat tag schema to eliminate the runtime ReferenceError.

## Implementation Plan
1. **Audit combat tag schemas**
   - Open `src/libs/combat/types.ts` around the `AllTags` definition to understand how tag schemas are declared and composed.
   - Identify existing tag naming conventions (e.g., `IncreasePoolCostTag`, `IncreaseStatTag`) to infer what the missing tags should look like.

2. **Search for missing definitions**
   - Search the repository for `IncreasePoolsTag`/`DecreasePoolsTag` to confirm whether they were renamed or removed elsewhere.
   - Compare with actual tag logic in `src/libs/combat/tags.ts` to map schemas to implementations.

3. **Decide on the correction**
   - If equivalent tag schemas already exist under different names (e.g., `IncreasePoolTag`), update the union to use the correct identifiers.
   - If the tags are genuinely missing but required, recreate their schemas based on nearby patterns (fields, defaults, zod shape) and ensure they line up with the tag logic file.

4. **Implement the fix**
   - Update `src/libs/combat/types.ts` (and `tags.ts` if necessary) with the corrected tag definitions/exports.
   - Ensure the `AllTags` union imports the right schemas and remains exhaustive.

5. **Verify the solution**
   - Run the profile page (or relevant tests/build if lightweight) to ensure the module now evaluates without errors.
   - Double-check for linter/type errors in the touched files.
