"use client";

import { useSession, useSessionList } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearPinnedSessionStorage,
  decidePinnedSession,
  isAuthRoute,
  pinChangeRequiresRemount,
  readPinnedSessionId,
  readPinnedUserId,
  resolvePinnedSession,
  writePinnedSessionId,
  writePinnedUserId,
} from "./sessionPin";

interface SessionPinContextValue {
  /** Clerk session id this tab is pinned to, or null before it resolves. */
  pinnedSessionId: string | null;
  /** User id of the pinned session, or null when no pinned session is signed in. */
  pinnedUserId: string | null;
  /** Count of signed-in Clerk sessions in the browser (undefined while loading). */
  signedInSessionCount: number | undefined;
  /** Mints a token for THIS tab's pinned session (not the browser-active one). */
  getPinnedToken: () => Promise<string | null>;
}

const SessionPinContext = createContext<SessionPinContextValue | null>(null);

/**
 * Pins each browser tab to a specific Clerk session.
 *
 * Clerk's active session is browser-global: with multiple accounts signed in, one
 * `lastActiveSessionId` is shared across tabs and re-resolved on reload/refocus,
 * so a tab can silently flip to another signed-in account. This provider records
 * the tab's session id in `sessionStorage` (per-tab, survives reload, not shared
 * across tabs) and exposes it so the app's identity (`UserContext`) and tRPC auth
 * (`TrpcClientProvider`) follow the PINNED session instead of the active one.
 *
 * It also replaces Clerk's `MultisessionAppSupport`: that component remounts the
 * app keyed on the ACTIVE session, which would re-flip the tab on every global
 * active-session change. Here we remount the subtree (fresh tRPC client + React
 * Query cache) only when the pin moves off a signed-in account (see
 * `pinChangeRequiresRemount`) — re-pinning the same account's fresh session, or
 * clearing a dead pin before the tab heads to the sign-in flow. The tab NEVER
 * silently adopts a different signed-in account: when the pinned session dies while
 * another account remains, the pin is released and the user picks an account on
 * /login explicitly. A background active-session change does not remount, and
 * neither does the first-load adoption of the tab's own account, so the normal
 * signed-in first load and post-sign-in redirect do not pay a tree-wide remount.
 */
export function SessionPinProvider(props: { children: React.ReactNode }) {
  const { isLoaded, sessions } = useSessionList();
  const { session: activeSession } = useSession();
  const activeSessionId = activeSession?.id ?? null;
  // The tab defers adopting the active session while on the sign-in / sign-up flow,
  // so signing in a different account there cleanly becomes this tab's account
  // instead of being blocked by an eagerly-adopted pre-existing one.
  const onAuthRoute = isAuthRoute(usePathname());

  // The tRPC headers() callback is created once and reads the latest values via
  // refs (it runs per request batch, outside React's render).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const [pinnedSessionId, setPinnedSessionId] = useState<string | null>(() =>
    readPinnedSessionId(),
  );
  const pinnedIdRef = useRef(pinnedSessionId);
  pinnedIdRef.current = pinnedSessionId;

  // Bump a remount key only on a cross-account pin change, so the keyed subtree below
  // gets a fresh tRPC client + React Query cache when (and only when) the tab moves
  // off one signed-in account — never on the first-load null → id adoption of the
  // tab's own account. Done with React's "adjust state during render" pattern (not an
  // effect) so the new key is in place before children render, avoiding a stale-key
  // commit that would mount then immediately remount the tree.
  const [remountKey, setRemountKey] = useState(0);
  const [prevPinnedId, setPrevPinnedId] = useState(pinnedSessionId);
  if (prevPinnedId !== pinnedSessionId) {
    if (pinChangeRequiresRemount(prevPinnedId, pinnedSessionId)) {
      setRemountKey((key) => key + 1);
    }
    setPrevPinnedId(pinnedSessionId);
  }

  // Adopt the active session as this tab's pin on first load (but not while on the
  // sign-in flow — see decidePinnedSession). A still-signed-in pin (in memory, the
  // source of truth) is NEVER overridden by a background active-session change —
  // that is what keeps the tab on its account. Re-runs when the tab leaves the auth
  // route so the just-signed-in account is adopted after the redirect.
  //
  // When the pinned session is DEAD (no longer signed in) and the active session
  // belongs to a DIFFERENT account, the decision is "release": clear the pin and
  // send the tab to the sign-in flow so the user picks an account explicitly. The
  // tab must never silently switch accounts. Nulling the pin remounts the app
  // subtree (see pinChangeRequiresRemount), which drops the old account's caches.
  const router = useRouter();
  // True from a "release" until the tab reaches the sign-in flow. In that window
  // the tab has no pin, so a Clerk sessions refresh re-running the effect before
  // the /login navigation completes would otherwise read as a first-load and adopt
  // the other account — the exact silent switch release exists to prevent.
  const releasedRef = useRef(false);
  useEffect(() => {
    if (!isLoaded) return;
    if (releasedRef.current) {
      if (!onAuthRoute) {
        // Still between release and the sign-in flow: adopt nothing, keep steering
        // to /login (re-issued in case the original navigation was interrupted).
        router.push("/login");
        return;
      }
      releasedRef.current = false;
    }
    const decision = decidePinnedSession({
      sessions,
      inMemoryPinnedId: pinnedIdRef.current,
      storedPinnedId: readPinnedSessionId(),
      storedPinnedUserId: readPinnedUserId(),
      activeSessionId,
      onAuthRoute,
    });
    if (decision.type === "set") {
      writePinnedSessionId(decision.id);
      const pinnedUser = resolvePinnedSession(sessions, decision.id)?.user?.id;
      if (pinnedUser) writePinnedUserId(pinnedUser);
      setPinnedSessionId(decision.id);
    } else if (decision.type === "clear" || decision.type === "release") {
      clearPinnedSessionStorage();
      setPinnedSessionId(null);
      if (decision.type === "release") {
        releasedRef.current = true;
        router.push("/login");
      }
    } else {
      // Backfill the stored user id for pins written before it existed, so a later
      // dead-pin recovery can tell "same account again" from "different account".
      const pinnedUser = resolvePinnedSession(sessions, pinnedIdRef.current)?.user?.id;
      if (pinnedUser && readPinnedUserId() !== pinnedUser)
        writePinnedUserId(pinnedUser);
    }
  }, [isLoaded, sessions, activeSessionId, onAuthRoute, router]);

  const pinnedSession = useMemo(
    () => resolvePinnedSession(sessions, pinnedSessionId),
    [sessions, pinnedSessionId],
  );

  const getPinnedToken = useCallback(async () => {
    const pinned = resolvePinnedSession(sessionsRef.current, pinnedIdRef.current);
    if (!pinned) return null;
    return pinned.getToken();
  }, []);

  // Mirror Clerk's `client.signedInSessions` (active + pending) so the fail-closed
  // multi-session detection never under-counts and falls back to the shared cookie.
  const signedInSessionCount = useMemo(
    () =>
      sessions?.filter((s) => s.status === "active" || s.status === "pending").length,
    [sessions],
  );

  const value = useMemo<SessionPinContextValue>(
    () => ({
      pinnedSessionId,
      pinnedUserId: pinnedSession?.user?.id ?? null,
      signedInSessionCount,
      getPinnedToken,
    }),
    [pinnedSessionId, pinnedSession, signedInSessionCount, getPinnedToken],
  );

  return (
    <SessionPinContext.Provider value={value}>
      <Fragment key={remountKey}>{props.children}</Fragment>
    </SessionPinContext.Provider>
  );
}

export function useSessionPin(): SessionPinContextValue {
  const ctx = useContext(SessionPinContext);
  if (!ctx) {
    throw new Error("useSessionPin must be used within a SessionPinProvider");
  }
  return ctx;
}
