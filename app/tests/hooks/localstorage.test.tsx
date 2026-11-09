import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { useLocalStorage } from "@/hooks/localstorage";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

describe("useLocalStorage URL anchors", () => {
  beforeEach(() => {
    installBrowserGlobals({ events: ["CustomEvent"] });
    window.history.replaceState({}, "", "/battlearena");
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    restoreBrowserGlobals();
  });

  it.each(["%", "%2", "%GG", "%E0%A4%A"])(
    "uses the default value when the initial fragment is malformed: %s",
    (fragment) => {
      window.history.replaceState({}, "", `/battlearena#${fragment}`);

      const { result } = renderHook(() => useLocalStorage("arenaTab", "Arena", true));

      expect(result.current[0]).toBe("Arena");
      expect(window.localStorage.getItem("arenaTab")).toBe('"Arena"');
    },
  );

  it("retains the stored value when the initial fragment is malformed", () => {
    window.localStorage.setItem("arenaTab", JSON.stringify("Training"));
    window.history.replaceState({}, "", "/battlearena#%");

    const { result } = renderHook(() => useLocalStorage("arenaTab", "Arena", true));

    expect(result.current[0]).toBe("Training");
    expect(window.localStorage.getItem("arenaTab")).toBe('"Training"');
  });

  it.each(["PVP Rank", "忍者", "100%"])(
    "decodes a valid initial fragment before consulting storage: %s",
    (value) => {
      window.localStorage.setItem("arenaTab", JSON.stringify("Training"));
      window.history.replaceState({}, "", `/battlearena#${encodeURIComponent(value)}`);

      const { result } = renderHook(() => useLocalStorage("arenaTab", "Arena", true));

      expect(result.current[0]).toBe(value);
      expect(window.localStorage.getItem("arenaTab")).toBe(JSON.stringify(value));
    },
  );

  it("ignores a malformed hashchange and handles the next valid fragment", () => {
    window.localStorage.setItem("arenaTab", JSON.stringify("Training"));
    const { result } = renderHook(() => useLocalStorage("arenaTab", "Arena", true));
    const errors: Event[] = [];
    const recordError = (event: Event) => errors.push(event);
    window.addEventListener("error", recordError);

    try {
      act(() => {
        window.history.replaceState({}, "", "/battlearena#%");
        window.dispatchEvent(new window.HashChangeEvent("hashchange"));
      });

      expect(errors).toHaveLength(0);
      expect(result.current[0]).toBe("Training");
      expect(window.localStorage.getItem("arenaTab")).toBe('"Training"');

      act(() => {
        window.history.replaceState({}, "", "/battlearena#PVP%20Rank");
        window.dispatchEvent(new window.HashChangeEvent("hashchange"));
      });

      expect(result.current[0]).toBe("PVP Rank");
      expect(window.localStorage.getItem("arenaTab")).toBe('"PVP Rank"');
    } finally {
      window.removeEventListener("error", recordError);
    }
  });

  it("preserves query parameters and storage synchronization after a bad fragment", () => {
    window.history.replaceState({}, "", "/battlearena?opponent=123#%");
    const first = renderHook(() => useLocalStorage("arenaTab", "Arena", true));
    const second = renderHook(() => useLocalStorage("arenaTab", "Arena", true));

    act(() => first.result.current[1]("Training"));

    expect(second.result.current[0]).toBe("Training");
    expect(window.location.pathname).toBe("/battlearena");
    expect(window.location.search).toBe("?opponent=123");
    expect(window.location.hash).toBe("");

    act(() => {
      window.dispatchEvent(
        new window.StorageEvent("storage", {
          key: "arenaTab",
          newValue: JSON.stringify("Sparring"),
          storageArea: window.localStorage,
        }),
      );
    });

    expect(first.result.current[0]).toBe("Sparring");
    expect(second.result.current[0]).toBe("Sparring");
    expect(window.localStorage.getItem("arenaTab")).toBe('"Sparring"');
  });

  it("does not rewrite an unchanged stored value on mount or synchronization", () => {
    window.localStorage.setItem("arenaTab", JSON.stringify("Training"));
    const write = spyOn(Object.getPrototypeOf(window.localStorage), "setItem");
    try {
      const first = renderHook(() => useLocalStorage("arenaTab", "Arena"));
      const second = renderHook(() => useLocalStorage("arenaTab", "Arena"));
      expect(write).not.toHaveBeenCalled();
      act(() => first.result.current[1]("Sparring"));
      expect(second.result.current[0]).toBe("Sparring");
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });

  it("leaves fragments untouched when anchor handling is disabled", () => {
    window.history.replaceState({}, "", "/battlearena#%");
    const { result } = renderHook(() => useLocalStorage("arenaTab", "Arena"));

    act(() => result.current[1]("Training"));

    expect(result.current[0]).toBe("Training");
    expect(window.location.hash).toBe("#%");
  });
});
