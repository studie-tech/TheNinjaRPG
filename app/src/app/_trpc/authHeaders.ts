/**
 * Builds the Authorization header for an outgoing tRPC request from the current
 * browser tab's Clerk session token.
 *
 * Under Clerk multi-session the `__session` cookie is shared across all tabs of a
 * browser and reflects whichever tab is currently active. A background request
 * from a non-focused tab would otherwise authenticate as the wrong account.
 * Sending the tab's own session token as a Bearer header makes the server
 * authenticate as THIS tab's session, because Clerk's request authentication
 * prefers the Authorization header over the cookie.
 *
 * Returns an empty object when there is no token so we never send "Bearer null".
 */
export function buildClerkAuthHeaders(
  token: string | null | undefined,
): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
