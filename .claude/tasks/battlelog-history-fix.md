# Fix battlelog history query

## Context
- Visiting `/battlelog/:battleid` invokes `combat.getBattleHistoryEntry`. The Drizzle `findFirst` returns `undefined` when no history row exists.
- TanStack Query is configured to throw if a query resolves to `undefined`, leading to the reported runtime error whenever the battle history row has already been pruned.
- We need to ensure the endpoint always resolves with a defined value and the UI handles missing history gracefully.

## Plan
1. **Confirm current endpoint behaviour** – Re-read `getBattleHistoryEntry` in `app/src/server/api/routers/combat.ts` and note the return type from Drizzle. This solidifies why `undefined` can surface and whether other callers rely on it.
2. **Normalize backend response** – Update the query implementation to explicitly return the row when found or `null` otherwise (or throw a `TRPCError`). Returning `null` preserves a successful request while satisfying TanStack’s requirement that data is defined. Ensure typings reflect the nullable result.
3. **Adjust battlelog page UX** – Update `app/src/app/battlelog/[battleid]/page.tsx` to detect when `battleHistory` is `null`/missing. Show a user-friendly notice (e.g. “This battle log is no longer available”) and guard features like the report button that depend on opponent metadata.
4. **Validate** – Rely on TypeScript to confirm the nullable types compile, and manually reason through the affected components. No automated test suite exists for this path, so a targeted lint/type check suffices if lightweight.

## Open Questions / Risks
- If other consumers expect the query to throw on missing battles, we might need to surface a `NOT_FOUND` error instead. After updating, scan the repo to confirm this hook isn’t reused elsewhere (currently only the battlelog page uses it).
