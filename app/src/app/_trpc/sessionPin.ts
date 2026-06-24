/**
 * Per-tab Clerk session pin (pure helpers).
 *
 * Clerk's "active session" is browser-global: with multiple accounts signed in, a
 * single `lastActiveSessionId` is shared across all tabs and re-resolved on
 * reload/refocus, so any tab can silently flip to another signed-in account. To
 * keep a tab on the account it is working as, we persist that account's Clerk
 * session id in `sessionStorage` (per-tab, survives reload, NOT shared across
 * tabs) and drive the app's identity + tRPC auth from that pinned session instead
 * of the active one. See `SessionPinProvider`.
 */

export const PINNED_SESSION_STORAGE_KEY = "tnr-pinned-clerk-session-id";

export function readPinnedSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(PINNED_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePinnedSessionId(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PINNED_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // sessionStorage can throw (private mode / quota). Pinning then falls back to
    // the active session, i.e. the pre-existing behavior — no worse than before.
  }
}

export function clearPinnedSessionId(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PINNED_SESSION_STORAGE_KEY);
  } catch {
    // ignore — see writePinnedSessionId
  }
}

/**
 * Resolves the pinned session from the browser's Clerk sessions. Returns the
 * matching signed-in (`status === "active"`) session, or null when the pin is
 * unset, the sessions have not loaded, or the pinned session is no longer signed
 * in (e.g. signed out in another tab).
 */
export function resolvePinnedSession<T extends { id: string; status: string }>(
  sessions: readonly T[] | undefined | null,
  pinnedSessionId: string | null,
): T | null {
  if (!pinnedSessionId || !sessions) return null;
  return (
    sessions.find((s) => s.id === pinnedSessionId && s.status === "active") ?? null
  );
}
