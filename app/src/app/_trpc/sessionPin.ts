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
export const PINNED_USER_STORAGE_KEY = "tnr-pinned-clerk-user-id";

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

/**
 * The Clerk USER id of the pinned session, stored alongside the session id. A
 * session id alone cannot tell whether a replacement session belongs to the same
 * account once the original session is gone from the sessions list, so this is
 * what lets a dead pin distinguish "same account signed in again" (silently
 * re-adopt) from "a different account is active" (never silently switch — see
 * `decidePinnedSession`).
 */
export function readPinnedUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(PINNED_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writePinnedUserId(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PINNED_USER_STORAGE_KEY, userId);
  } catch {
    // Same failure mode as writePinnedSessionId: a missing stored user id only
    // means a later dead-pin recovery routes through the explicit sign-in flow
    // instead of silently re-adopting — safe, never account-swapping.
  }
}

export function clearPinnedSessionStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PINNED_SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(PINNED_USER_STORAGE_KEY);
  } catch {
    // Ignore: with storage unavailable there is nothing stale to clear.
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

/**
 * Whether `pathname` is part of Clerk's sign-in / sign-up flow (`/login`, `/signup`,
 * and their sub-routes such as `/login/factor-one` or `/login/sso-callback`).
 *
 * On these routes the tab must NOT eagerly adopt the browser-global active session
 * (see `decidePinnedSession`): the user may be about to sign in a DIFFERENT account.
 * Matches on segment boundaries so look-alikes like `/login-help` are not auth routes.
 */
export function isAuthRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/signup" ||
    pathname.startsWith("/signup/")
  );
}

export type PinDecision =
  | { type: "keep" }
  | { type: "set"; id: string }
  | { type: "clear" }
  | { type: "release" };

/**
 * Decides this tab's pinned session id from the current Clerk state, WITHOUT ever
 * letting a background active-session change reassign a tab that already holds a
 * valid pin. The in-memory pin (`inMemoryPinnedId`) is the source of truth — it is
 * NOT re-derived from `sessionStorage`, so a failed/empty `sessionStorage` read
 * can never cause the tab to flip identities.
 *
 * Order: keep a still-signed-in in-memory pin → recover a still-signed-in stored
 * pin (e.g. after reload) → otherwise, only once the sessions list is populated
 * (never mid-refresh when it is momentarily empty), decide what a tab without a
 * usable pin does:
 *
 * - A tab that never had a pin adopts the active session on first load (but not
 *   while on the sign-in flow — adoption happens after the redirect).
 * - A tab whose pin is DEAD (the pinned session is no longer signed in) only
 *   silently re-adopts the active session when it belongs to the SAME account
 *   (matched via the stored pinned user id — e.g. the user signed in again after
 *   expiry). When the active session belongs to a different account — or the
 *   pinned account is unknown — the decision is `release`: the tab must never
 *   silently switch to another signed-in account; the caller clears the pin and
 *   sends the tab through the sign-in flow so the user picks an account
 *   explicitly.
 * - On the sign-in flow a dead pin is `clear`ed (not kept): the user is about to
 *   choose an account there, and a lingering dead pin would otherwise read as a
 *   cross-account move and bounce the tab straight back to sign-in afterwards.
 */
export function decidePinnedSession<
  T extends { id: string; status: string; user?: { id: string } | null },
>(args: {
  sessions: readonly T[] | undefined | null;
  inMemoryPinnedId: string | null;
  storedPinnedId: string | null;
  storedPinnedUserId: string | null;
  activeSessionId: string | null;
  onAuthRoute: boolean;
}): PinDecision {
  const {
    sessions,
    inMemoryPinnedId,
    storedPinnedId,
    storedPinnedUserId,
    activeSessionId,
    onAuthRoute,
  } = args;
  if (resolvePinnedSession(sessions, inMemoryPinnedId)) return { type: "keep" };
  const storedSession = resolvePinnedSession(sessions, storedPinnedId);
  if (storedSession) {
    return storedSession.id === inMemoryPinnedId
      ? { type: "keep" }
      : { type: "set", id: storedSession.id };
  }
  // Sessions momentarily empty (Clerk mid-refresh): leave the pin untouched rather
  // than re-adopting and flipping the tab.
  if (!sessions || sessions.length === 0) return { type: "keep" };
  // From here on the tab either never had a pin, or its pin is dead (the pinned
  // session is no longer signed in).
  const hadPin = inMemoryPinnedId !== null || storedPinnedId !== null;
  // On the sign-in / sign-up flow, do NOT eagerly adopt the browser-global active
  // session: the user may be about to sign in a DIFFERENT account, and an eager pin
  // here would later block that in-tab switch (the active session changes to the new
  // account, but the now-"valid" eager pin keeps the old one). Adoption happens once
  // the completed sign-in redirects the tab onto an app route. An already-established
  // pin is honored above, so a pinned tab visiting /login keeps its own account. A
  // DEAD pin is cleared here so whatever account comes out of the sign-in flow is
  // adopted cleanly instead of being mistaken for a cross-account move.
  if (onAuthRoute) return hadPin ? { type: "clear" } : { type: "keep" };
  // Only a signed-in active session can be adopted (like the in-memory and stored
  // paths) so getPinnedToken can still mint a token for it.
  const activeSession = resolvePinnedSession(sessions, activeSessionId);
  if (!activeSession) return { type: "keep" };
  // First load with no pin: adopt the active session.
  if (!hadPin) return { type: "set", id: activeSession.id };
  // Dead pin: silently re-adopt only the SAME account (e.g. a fresh session after
  // the old one expired). A different or unknown account must never be adopted
  // silently — that is exactly the "randomly swapped to my other account" bug.
  if (storedPinnedUserId && activeSession.user?.id === storedPinnedUserId) {
    return { type: "set", id: activeSession.id };
  }
  return { type: "release" };
}

/**
 * Whether a change of this tab's pinned session id should remount the app subtree
 * (fresh tRPC client + React Query cache). True whenever the pin moves OFF a
 * signed-in account to a different value — re-pinning to the same account's fresh
 * session (A → A'), or nulling the pin on a `clear`/`release` decision before the
 * tab heads to the sign-in flow. Such a move can leave the previous account's data
 * behind in React Query caches that are not scoped per account (`profile.getUser`
 * is scoped via `getUserQueryInput`, but other queries are not), so the subtree
 * must remount to discard it.
 *
 * The first-load `null → id` adoption returns false (no remount): the brief unpinned
 * window does not populate any account-private cache. Account-private queries are
 * gated on the pinned user — `profile.getUser` is `enabled: !!userId`, and everything
 * private cascades from its `userData` — so they do not run while the pin is null.
 * The only always-mounted query that runs unpinned is the public, account-agnostic
 * leaderboard (`profile.getPublicUsers`), whose data is identical for every viewer.
 *
 * INVARIANT this relies on: an always-mounted, account-private query must gate its
 * `enabled` on the pinned user (`userData`/`pinnedUserId`), NOT on Clerk's browser-
 * global `isSignedIn`/`useUser`. Gating on the latter would let it fetch and cache the
 * browser-active account's private data during the null-pin window (e.g. on `/login`
 * before adopting a just-signed-in second account), which this skipped remount would
 * then fail to discard.
 */
export function pinChangeRequiresRemount(
  prev: string | null,
  next: string | null,
): boolean {
  return prev !== null && prev !== next;
}
