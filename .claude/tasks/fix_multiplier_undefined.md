# Fix multiplier undefined in combat pool adjustments

## Goal
Resolve the `ReferenceError: multiplier is not defined` that occurs when applying `increaseMaxPools` or `decreaseMaxPools` item effects during `processUsersForBattle`, ensuring pool adjustments behave correctly for both increases and decreases.

## Plan
1. **Review existing pool adjustment logic in `src/server/api/routers/combat.ts`.**
   - *Reasoning:* Need precise context around how realized tags are processed, what data structures exist (e.g., `realized.timeTracker`) and whether similar logic exists elsewhere that already defines a multiplier.
2. **Check related tag implementations (likely in `src/libs/combat/tags.ts`).**
   - *Reasoning:* Ensures our fix aligns with how `increaseMaxPools`/`decreaseMaxPools` are meant to work elsewhere (e.g., during combat rounds) and reuses consistent calculations.
3. **Adjust the preprocessing logic to derive a `multiplier` based on `isIncrease` and apply pool changes safely.**
   - *Reasoning:* Prevents the ReferenceError and correctly updates both max and current pool values, clamping them at zero to avoid negatives, mirroring runtime combat behavior.
4. **Add defensive handling for missing pools/effects and ensure `timeTracker` entries remain accurate.**
   - *Reasoning:* Avoids future regressions if effects specify multiple pools or repeated applications; keeps downstream code relying on `timeTracker` consistent.
5. **Verify TypeScript integrity and, if feasible, cover via existing tests or a lightweight manual invocation.**
   - *Reasoning:* Confirms the fix compiles and prevents recurrence before handing back to the user.

## Testing Ideas
- Trigger `combat.startArenaBattle` against an AI with items that apply `increaseMaxPools` to ensure the call succeeds.
- Run any targeted unit/integration tests touching combat tag processing if available (skip full test suite unless necessary).
