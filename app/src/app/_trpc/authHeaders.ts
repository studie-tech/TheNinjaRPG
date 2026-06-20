/**
 * Header the browser client sets when it intended to authenticate with a per-tab
 * bearer token but `getToken()` failed (e.g. an offline/refresh blip). The server
 * uses it to fail closed instead of authenticating via the shared `__session`
 * cookie. See `resolveAuthedUserId` in `@/server/api/authContext`.
 */
export const TAB_AUTH_REQUIRED_HEADER = "x-tnr-auth-required";

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

/**
 * Headers to send when `getToken()` throws (offline/refresh blip) and we could
 * not attach the tab's bearer token.
 *
 * Only signals fail-closed when the browser actually has multiple Clerk sessions:
 * then the shared `__session` cookie may belong to a different tab's account, so
 * the server must NOT fall back to it. For a single-session browser the cookie is
 * the user's own account, so we send nothing and let it authenticate normally
 * (failing closed there would be a needless regression during network blips).
 */
export function buildClerkAuthFailureHeaders(
  isMultiSession: boolean,
): Record<string, string> {
  return isMultiSession ? { [TAB_AUTH_REQUIRED_HEADER]: "1" } : {};
}
