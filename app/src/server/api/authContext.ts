/**
 * Resolves the authenticated user id for a tRPC request under Clerk multi-session.
 *
 * Fail-closed rule: if the browser client signalled that it intended to send a
 * per-tab bearer token but could not (the `tabAuthFailed` marker header) and no
 * Authorization header actually arrived, we must NOT authenticate via the shared,
 * browser-global `__session` cookie — it may belong to a different tab's account.
 * In that case return null so the request is treated as unauthenticated.
 *
 * Otherwise return the session's user id as resolved by Clerk (`auth()`), which
 * already prefers the Authorization header over the cookie when a token is present.
 */
export function resolveAuthedUserId(
  sessionUserId: string | null,
  opts: { hasAuthorizationHeader: boolean; tabAuthFailed: boolean },
): string | null {
  if (opts.tabAuthFailed && !opts.hasAuthorizationHeader) {
    return null;
  }
  return sessionUserId;
}
