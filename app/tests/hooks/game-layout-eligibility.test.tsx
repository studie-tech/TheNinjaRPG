import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { useAvailableGameLayouts, useCanUseSectorLayout } from "@/hooks/useGameLayout";
import { mockUserContextValue } from "../setup/userContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("withdraws character-only layouts across hydration, account switches and sign-out", () => {
  const session = {
    isClerkLoaded: false,
    isSignedIn: true,
    userId: "player",
    data: undefined as { userId: string } | undefined,
  };
  mockUserContextValue(() => session);
  const { result, rerender } = renderHook(() => ({
    allowed: useCanUseSectorLayout(),
    choices: useAvailableGameLayouts().map((layout) => layout.id),
  }));
  expect(result.current.allowed).toBe(false);
  session.isClerkLoaded = true;
  rerender();
  expect(result.current.allowed).toBe(false);
  session.data = { userId: "player" };
  rerender();
  expect(result.current.allowed).toBe(true);
  expect(result.current.choices).toContain("sector");
  session.userId = "other-player";
  rerender();
  expect(result.current.allowed).toBe(false);
  expect(result.current.choices).not.toContain("sector");
  session.data = { userId: "other-player" };
  rerender();
  expect(result.current.allowed).toBe(true);
  session.isSignedIn = false;
  rerender();
  expect(result.current.allowed).toBe(false);
  expect(result.current.choices).not.toContain("sector");
});
