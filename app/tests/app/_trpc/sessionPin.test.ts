import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPinnedSessionId,
  readPinnedSessionId,
  resolvePinnedSession,
  writePinnedSessionId,
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

afterEach(() => {
  vi.unstubAllGlobals();
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
  it("round-trips read/write/clear via sessionStorage", () => {
    vi.stubGlobal("window", makeFakeWindow());
    expect(readPinnedSessionId()).toBeNull();
    writePinnedSessionId("sess_a");
    expect(readPinnedSessionId()).toBe("sess_a");
    clearPinnedSessionId();
    expect(readPinnedSessionId()).toBeNull();
  });

  it("is a safe no-op without window (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => writePinnedSessionId("x")).not.toThrow();
    expect(() => clearPinnedSessionId()).not.toThrow();
    expect(readPinnedSessionId()).toBeNull();
  });
});
