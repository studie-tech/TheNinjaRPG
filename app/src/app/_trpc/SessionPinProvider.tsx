"use client";

import { useSession, useSessionList } from "@clerk/nextjs";
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
  clearPinnedSessionId,
  readPinnedSessionId,
  resolvePinnedSession,
  writePinnedSessionId,
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
  /** Pins this tab to a different signed-in session (an intentional in-tab switch). */
  switchPinnedAccount: (sessionId: string) => void;
  /** Clears the pin (used on sign-out). */
  clearPin: () => void;
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
 * active-session change. Here we key the subtree on the PINNED session, so an
 * intentional in-tab account switch cleanly remounts (fresh tRPC client + React
 * Query cache) while a background active-session change does not.
 */
export function SessionPinProvider(props: { children: React.ReactNode }) {
  const { isLoaded, sessions, setActive } = useSessionList();
  const { session: activeSession } = useSession();
  const activeSessionId = activeSession?.id ?? null;

  // The tRPC headers() callback is created once and reads the latest values via
  // refs (it runs per request batch, outside React's render).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const setActiveRef = useRef(setActive);
  setActiveRef.current = setActive;

  const [pinnedSessionId, setPinnedSessionId] = useState<string | null>(() =>
    readPinnedSessionId(),
  );
  const pinnedIdRef = useRef(pinnedSessionId);
  pinnedIdRef.current = pinnedSessionId;

  // Adopt the active session as this tab's pin on first load, and re-adopt only if
  // the stored pin is no longer a signed-in session (e.g. signed out elsewhere). A
  // still-valid stored pin is NEVER overridden by a background active-session
  // change — that is what keeps the tab on its account.
  useEffect(() => {
    if (!isLoaded) return;
    const stored = readPinnedSessionId();
    if (resolvePinnedSession(sessions, stored)) {
      if (pinnedIdRef.current !== stored) setPinnedSessionId(stored);
      return;
    }
    if (activeSessionId) {
      writePinnedSessionId(activeSessionId);
      setPinnedSessionId(activeSessionId);
    } else if (pinnedIdRef.current !== null) {
      clearPinnedSessionId();
      setPinnedSessionId(null);
    }
  }, [isLoaded, sessions, activeSessionId]);

  const pinnedSession = useMemo(
    () => resolvePinnedSession(sessions, pinnedSessionId),
    [sessions, pinnedSessionId],
  );

  const getPinnedToken = useCallback(async () => {
    const pinned = resolvePinnedSession(sessionsRef.current, pinnedIdRef.current);
    if (!pinned) return null;
    return pinned.getToken();
  }, []);

  const switchPinnedAccount = useCallback((sessionId: string) => {
    writePinnedSessionId(sessionId);
    setPinnedSessionId(sessionId);
    // Align Clerk's active session for UI consistency (e.g. UserButton); the app's
    // data/auth use the pin directly and do not depend on this succeeding.
    void setActiveRef.current?.({ session: sessionId });
  }, []);

  const clearPin = useCallback(() => {
    clearPinnedSessionId();
    setPinnedSessionId(null);
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
      switchPinnedAccount,
      clearPin,
    }),
    [
      pinnedSessionId,
      pinnedSession,
      signedInSessionCount,
      getPinnedToken,
      switchPinnedAccount,
      clearPin,
    ],
  );

  return (
    <SessionPinContext.Provider value={value}>
      <Fragment key={pinnedSessionId ?? "no-pin"}>{props.children}</Fragment>
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
