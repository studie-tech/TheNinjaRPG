import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { useLocalStorage } from "@/hooks/localstorage";
import { useAvatarRenditionWidth } from "@/layout/Avatar";
import { LIGHT_LAYOUT_STORAGE_KEY } from "@/libs/layoutPreference";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const Probe = ({ record }: { record?: (width: number) => void }) => {
  const width = useAvatarRenditionWidth(100);
  record?.(width);
  return <span>{width}</span>;
};

describe("avatar preference snapshots", () => {
  beforeEach(() => {
    installBrowserGlobals({ events: ["CustomEvent"] });
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    restoreBrowserGlobals();
    window.localStorage.clear();
  });

  it("uses the saved small rendition on the first client-only render", () => {
    window.localStorage.setItem(LIGHT_LAYOUT_STORAGE_KEY, "true");
    const widths: number[] = [];
    render(<Probe record={(width) => widths.push(width)} />);
    expect(widths[0]).toBe(100);
    expect(widths).not.toContain(320);
  });

  it("shares listeners, never writes on mount, and cleans up its last subscription", () => {
    window.localStorage.setItem(LIGHT_LAYOUT_STORAGE_KEY, "true");
    const add = spyOn(window, "addEventListener");
    const remove = spyOn(window, "removeEventListener");
    const write = spyOn(Object.getPrototypeOf(window.localStorage), "setItem");
    const isStorageEvent = ([type]: unknown[]) =>
      type === "storage" || type === "localStorageSync";
    try {
      const first = renderHook(() => useAvatarRenditionWidth(100));
      const second = renderHook(() => useAvatarRenditionWidth(50));
      expect(first.result.current).toBe(100);
      expect(second.result.current).toBe(50);
      expect(add.mock.calls.filter(isStorageEvent)).toHaveLength(2);
      expect(write).not.toHaveBeenCalled();
      first.unmount();
      expect(remove.mock.calls.filter(isStorageEvent)).toHaveLength(0);
      second.unmount();
      expect(remove.mock.calls.filter(isStorageEvent)).toHaveLength(2);
      window.localStorage.setItem(LIGHT_LAYOUT_STORAGE_KEY, "false");
      const remounted = renderHook(() => useAvatarRenditionWidth(100));
      expect(remounted.result.current).toBe(320);
      remounted.unmount();
    } finally {
      add.mockRestore();
      remove.mockRestore();
      write.mockRestore();
    }
  });

  it("hydrates the server rendition without a mismatch before applying light mode", async () => {
    window.localStorage.setItem(LIGHT_LAYOUT_STORAGE_KEY, "true");
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    expect(container.textContent).toBe("320");
    document.body.appendChild(container);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(container, <Probe />, {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      expect(container.textContent).toBe("100");
      expect(errors).toEqual([]);
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });

  it("follows same-page settings changes and cross-tab removal", () => {
    const avatar = renderHook(() => useAvatarRenditionWidth(100));
    const settings = renderHook(() => useLocalStorage(LIGHT_LAYOUT_STORAGE_KEY, false));
    act(() => settings.result.current[1](true));
    expect(avatar.result.current).toBe(100);
    act(() => {
      window.localStorage.removeItem(LIGHT_LAYOUT_STORAGE_KEY);
      window.dispatchEvent(
        new window.StorageEvent("storage", {
          key: LIGHT_LAYOUT_STORAGE_KEY,
          newValue: null,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(avatar.result.current).toBe(320);
  });

  it("honors same-page events even before persistence and when storage is blocked", () => {
    const avatar = renderHook(() => useAvatarRenditionWidth(100));
    const read = spyOn(
      Object.getPrototypeOf(window.localStorage),
      "getItem",
    ).mockImplementation(() => {
      throw new Error("Storage disabled");
    });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      act(() =>
        window.dispatchEvent(
          new window.CustomEvent("localStorageSync", {
            detail: { key: LIGHT_LAYOUT_STORAGE_KEY, value: "true" },
          }),
        ),
      );
      expect(avatar.result.current).toBe(100);
      act(() =>
        window.dispatchEvent(
          new window.CustomEvent("localStorageSync", {
            detail: { key: "another-key", value: "false" },
          }),
        ),
      );
      expect(avatar.result.current).toBe(100);
    } finally {
      read.mockRestore();
      warn.mockRestore();
    }
  });
});
