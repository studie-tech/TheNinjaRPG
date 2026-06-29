/**
 * Per-account input for `profile.getUser`, so the React Query cache is scoped by
 * Clerk account and cannot serve one account's data to another under multi-session.
 *
 * Returns `undefined` for a falsy `userId` (which targets the legacy unscoped cache
 * key); callers that must write to a real account should guard on a truthy `userId`.
 * Shared between `UserContext` and `PusherHandler` so the cache-key shape has a
 * single source of truth and cannot drift between call sites.
 */
export const getUserQueryInput = (
  userId: string | null | undefined,
): { viewerId: string } | undefined => (userId ? { viewerId: userId } : undefined);
