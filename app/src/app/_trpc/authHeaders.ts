/**
 * Header the browser client sets when it intended to authenticate with a per-tab
 * bearer token but has none (signed out, not yet loaded, or `getToken()` failed).
 * The server uses it to fail closed instead of authenticating via the shared
 * `__session` cookie. See `resolveAuthedUserId` in `@/server/api/authContext`.
 */
export const TAB_AUTH_REQUIRED_HEADER = "x-tnr-auth-required";

/**
 * Builds the auth headers for an outgoing tRPC request under Clerk multi-session.
 *
 * The `__session` cookie is shared across all browser tabs and reflects whichever
 * tab is focused, so a background request from a non-focused tab could otherwise
 * authenticate as the wrong account. We attach the tab's OWN session token as a
 * Bearer header (Clerk's request auth prefers the header over the cookie) so the
 * server authenticates as this tab's session.
 *
 * When the tab has no token (signed out, not yet loaded, or `getToken()` failed)
 * we must not let the server fall back to the shared cookie if the browser holds
 * multiple sessions — instead we send a marker so the server fails closed. For a
 * single-session browser the cookie is the user's own account, so we send nothing
 * and authenticate normally (failing closed there would be a needless regression
 * during transient token blips).
 */
export function buildClerkRequestHeaders(
  token: string | null | undefined,
  isMultiSession: boolean,
): Record<string, string> {
  if (token) return { Authorization: `Bearer ${token}` };
  return isMultiSession ? { [TAB_AUTH_REQUIRED_HEADER]: "1" } : {};
}
