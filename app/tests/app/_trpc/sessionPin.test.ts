import { afterEach, describe, expect, it } from "vitest";
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
} from "@/app/_trpc/sessionPin";

const makeFakeWindow = () => {
  const store = new Map<string, string>();
  return {
    sessionStorage: {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
};

// CI runs `bun test`, whose `vi` shim lacks `stubGlobal`/`unstubAllGlobals`, so swap
// `window` by direct assignment and restore the value captured at module load.
const g = globalThis as unknown as { window?: unknown };
const originalWindow = g.window;
afterEach(() => {
  g.window = originalWindow;
});

describe("resolvePinnedSession", () => {
  const sessions = [
    { id: "sess_a", status: "active", user: { id: "user_a" } },
    { id: "sess_b", status: "active", user: { id: "user_b" } },
    { id: "sess_old", status: "ended", user: { id: "user_c" } },
  ];

  it("returns the matching signed-in session", () => {
    expect(resolvePinnedSession(sessions, "sess_b")?.id).toBe("sess_b");
  });

  it("returns null when the pin is unset", () => {
    expect(resolvePinnedSession(sessions, null)).toBeNull();
  });

  it("returns null when the pinned session is not present", () => {
    expect(resolvePinnedSession(sessions, "sess_missing")).toBeNull();
  });

  it("does not match a non-active (ended/expired) session", () => {
    expect(resolvePinnedSession(sessions, "sess_old")).toBeNull();
  });

  it("returns null when sessions have not loaded", () => {
    expect(resolvePinnedSession(undefined, "sess_a")).toBeNull();
    expect(resolvePinnedSession(null, "sess_a")).toBeNull();
  });
});

describe("pinned session id storage", () => {
  it("round-trips read/write via sessionStorage", () => {
    g.window = makeFakeWindow();
    expect(readPinnedSessionId()).toBeNull();
    writePinnedSessionId("sess_a");
    expect(readPinnedSessionId()).toBe("sess_a");
    writePinnedSessionId("sess_b");
    expect(readPinnedSessionId()).toBe("sess_b");
  });

  it("round-trips the pinned user id and clears both keys together", () => {
    g.window = makeFakeWindow();
    writePinnedSessionId("sess_a");
    writePinnedUserId("user_a");
    expect(readPinnedUserId()).toBe("user_a");
    clearPinnedSessionStorage();
    expect(readPinnedSessionId()).toBeNull();
    expect(readPinnedUserId()).toBeNull();
  });

  it("is a safe no-op without window (SSR)", () => {
    g.window = undefined;
    expect(() => writePinnedSessionId("x")).not.toThrow();
    expect(() => writePinnedUserId("x")).not.toThrow();
    expect(() => clearPinnedSessionStorage()).not.toThrow();
    expect(readPinnedSessionId()).toBeNull();
    expect(readPinnedUserId()).toBeNull();
  });
});

describe("isAuthRoute", () => {
  it("matches the sign-in and sign-up routes and their sub-routes", () => {
    expect(isAuthRoute("/login")).toBe(true);
    expect(isAuthRoute("/login/factor-one")).toBe(true);
    expect(isAuthRoute("/login/sso-callback")).toBe(true);
    expect(isAuthRoute("/signup")).toBe(true);
    expect(isAuthRoute("/signup/verify-email-address")).toBe(true);
  });

  it("does not match app routes or look-alike prefixes", () => {
    expect(isAuthRoute("/")).toBe(false);
    expect(isAuthRoute("/profile")).toBe(false);
    // Segment-exact: a route that merely starts with the word is not an auth route.
    expect(isAuthRoute("/login-help")).toBe(false);
    expect(isAuthRoute("/signup-confirmation")).toBe(false);
    expect(isAuthRoute(null)).toBe(false);
    expect(isAuthRoute(undefined)).toBe(false);
  });
});

describe("decidePinnedSession", () => {
  const sessions = [
    { id: "sess_main", status: "active", user: { id: "user_main" } },
    { id: "sess_alt", status: "active", user: { id: "user_alt" } },
  ];

  it("keeps a still-signed-in in-memory pin even when the stored read returns null (no flip)", () => {
    // The reported bug: sessionStorage read fails -> null, active session changed
    // to the alt -> the tab must NOT re-adopt the alt.
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: "sess_main",
        storedPinnedId: null,
        storedPinnedUserId: null,
        activeSessionId: "sess_alt",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "keep" });
  });

  it("adopts the active session on first load when there is no pin", () => {
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: null,
        storedPinnedId: null,
        storedPinnedUserId: null,
        activeSessionId: "sess_main",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "set", id: "sess_main" });
  });

  it("recovers a still-signed-in stored pin (e.g. after reload)", () => {
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: null,
        storedPinnedId: "sess_alt",
        storedPinnedUserId: "user_alt",
        activeSessionId: "sess_main",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "set", id: "sess_alt" });
  });

  it("does not disturb the pin while the sessions list is momentarily empty", () => {
    expect(
      decidePinnedSession({
        sessions: [],
        inMemoryPinnedId: "sess_main",
        storedPinnedId: null,
        storedPinnedUserId: "user_main",
        activeSessionId: null,
        onAuthRoute: false,
      }),
    ).toEqual({ type: "keep" });
  });

  it("releases (never silently adopts) when the pinned account died and a DIFFERENT account is active", () => {
    // The "randomly swapped to my other account" bug: the pinned session expired /
    // was signed out while the alt remains. The tab must not silently become the
    // alt — it releases the pin and routes through the sign-in flow instead.
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: "sess_dead",
        storedPinnedId: "sess_dead",
        storedPinnedUserId: "user_main",
        activeSessionId: "sess_alt",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "release" });
  });

  it("releases when the pinned account died and its account is unknown (no stored user id)", () => {
    // Without a stored user id we cannot prove the active session is the same
    // account, so the safe decision is the explicit sign-in flow, never adoption.
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: "sess_dead",
        storedPinnedId: "sess_dead",
        storedPinnedUserId: null,
        activeSessionId: "sess_alt",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "release" });
  });

  it("silently re-adopts a fresh session of the SAME account after the pinned one died", () => {
    // E.g. the session expired and the user signed in again: new session id, same
    // account. This must not bounce the user through the sign-in flow.
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: "sess_dead",
        storedPinnedId: "sess_dead",
        storedPinnedUserId: "user_main",
        activeSessionId: "sess_main",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "set", id: "sess_main" });
  });

  it("keeps a dead pin while no signed-in active session exists (nothing to adopt or release to)", () => {
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: "sess_dead",
        storedPinnedId: "sess_dead",
        storedPinnedUserId: "user_main",
        activeSessionId: null,
        onAuthRoute: false,
      }),
    ).toEqual({ type: "keep" });
  });

  it("does not pin an active session that is not a signed-in session (no phantom pin)", () => {
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: null,
        storedPinnedId: null,
        storedPinnedUserId: null,
        activeSessionId: "sess_not_in_list",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "keep" });
  });

  // Fresh-tab second-account sign-in (the /tnr-review-now repro): a fresh tab lands
  // on /login while account "main" is already signed in browser-wide, then signs in
  // "alt". The tab must end up on alt, not main.
  it("defers adopting the active session while on the sign-in flow (no eager pin)", () => {
    // Fresh tab on /login: main is the browser-global active session, but the user
    // has not acted yet. Adopting main here is what blocked the later switch to alt.
    expect(
      decidePinnedSession({
        sessions: [{ id: "sess_main", status: "active", user: { id: "user_main" } }],
        inMemoryPinnedId: null,
        storedPinnedId: null,
        storedPinnedUserId: null,
        activeSessionId: "sess_main",
        onAuthRoute: true,
      }),
    ).toEqual({ type: "keep" });
  });

  it("keeps deferring on the auth flow even after the new account becomes active", () => {
    // The user signed in alt; Clerk added sess_alt and made it active, but the tab is
    // still momentarily on /login. Still defer — adoption happens after the redirect.
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: null,
        storedPinnedId: null,
        storedPinnedUserId: null,
        activeSessionId: "sess_alt",
        onAuthRoute: true,
      }),
    ).toEqual({ type: "keep" });
  });

  it("clears a dead pin on the sign-in flow so the chosen account adopts cleanly afterwards", () => {
    // A released tab lands on /login still carrying the dead pin. Clearing it here
    // is what prevents the post-sign-in adoption from reading as a cross-account
    // move and bouncing the tab straight back to /login.
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: "sess_dead",
        storedPinnedId: "sess_dead",
        storedPinnedUserId: "user_main",
        activeSessionId: "sess_alt",
        onAuthRoute: true,
      }),
    ).toEqual({ type: "clear" });
  });

  it("adopts the just-signed-in account once redirected off the auth flow", () => {
    // <SignIn> redirected onto an app route. onAuthRoute is false only BECAUSE that
    // navigation ran, which is downstream of Clerk setting the new active session —
    // so activeSessionId is already the new account here (not a stale value). The
    // dead pin was cleared while on the auth route, so this is a no-pin adoption.
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: null,
        storedPinnedId: null,
        storedPinnedUserId: null,
        activeSessionId: "sess_alt",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "set", id: "sess_alt" });
  });

  it("does not flip an established pin when another tab makes a new account active (cross-tab protection)", () => {
    // Regression guard for the ORIGINAL reported bug: a background sign-in in another
    // tab adds sess_alt and makes it active. A tab already pinned to main must keep
    // main — the auth-route deferral must NOT have weakened this.
    expect(
      decidePinnedSession({
        sessions,
        inMemoryPinnedId: "sess_main",
        storedPinnedId: "sess_main",
        storedPinnedUserId: "user_main",
        activeSessionId: "sess_alt",
        onAuthRoute: false,
      }),
    ).toEqual({ type: "keep" });
  });
});

describe("pinChangeRequiresRemount", () => {
  it("does NOT remount on the first-load null -> id adoption", () => {
    // The tab adopts its own account; the unpinned window authenticated as that same
    // account (or fetched nothing), so a tree-wide remount + refetch would be waste.
    expect(pinChangeRequiresRemount(null, "sess_a")).toBe(false);
  });

  it("remounts when the pin moves to a different session (e.g. same account, fresh session)", () => {
    // The previous session's data may sit in unscoped React Query caches, discard it.
    expect(pinChangeRequiresRemount("sess_a", "sess_b")).toBe(true);
  });

  it("remounts on an id -> null change (clear/release of a dead pin)", () => {
    expect(pinChangeRequiresRemount("sess_a", null)).toBe(true);
  });

  it("does not remount when the pin is unchanged", () => {
    expect(pinChangeRequiresRemount("sess_a", "sess_a")).toBe(false);
    expect(pinChangeRequiresRemount(null, null)).toBe(false);
  });
});
