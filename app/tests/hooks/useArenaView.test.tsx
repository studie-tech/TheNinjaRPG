import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { useArenaView } from "@/hooks/useArenaView";

const eventDescriptor = Object.getOwnPropertyDescriptor(globalThis, "PopStateEvent");

describe("useArenaView", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "PopStateEvent", {
      configurable: true,
      value: window.PopStateEvent,
    });
    window.history.replaceState({}, "", "/battlearena");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    if (eventDescriptor)
      Object.defineProperty(globalThis, "PopStateEvent", eventDescriptor);
    else Reflect.deleteProperty(globalThis, "PopStateEvent");
  });

  it("reads the mode from the hash", () => {
    window.history.replaceState({}, "", "/battlearena#PVP%20Rank");
    const { result } = renderHook(() => useArenaView());
    expect(result.current.mode).toBe("PVP Rank");
  });

  it("opens a mode and returns to the overview", () => {
    const { result } = renderHook(() => useArenaView());
    expect(result.current.mode).toBeNull();
    act(() => result.current.openMode("Battle Pyramid"));
    expect(window.location.hash).toBe("#Battle%20Pyramid");
    expect(result.current.mode).toBe("Battle Pyramid");
    act(() => result.current.openOverview());
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/battlearena");
    expect(result.current.mode).toBeNull();
  });

  it("does not add history entries for the current mode or overview", () => {
    const { result } = renderHook(() => useArenaView());
    const initialLength = window.history.length;
    act(() => result.current.openOverview());
    expect(window.history.length).toBe(initialLength);
    act(() => result.current.openMode("Training"));
    const modeLength = window.history.length;
    act(() => result.current.openMode("Training"));
    expect(window.history.length).toBe(modeLength);
  });

  it("follows back navigation", () => {
    const { result } = renderHook(() => useArenaView());
    act(() => {
      window.history.replaceState({}, "", "/battlearena#Training");
      window.dispatchEvent(new window.PopStateEvent("popstate"));
    });
    expect(result.current.mode).toBe("Training");
  });
});
