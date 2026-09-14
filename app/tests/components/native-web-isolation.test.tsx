import { ensureDom } from "../setup-dom.mjs";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as Google from "@next/third-parties/google";
import { afterEach, describe, expect, it, vi } from "vitest";
import PWAManager from "@/components/pwa/PWAManager";
import * as NativeShell from "@/hooks/useNativeShell";
import { WebAnalytics } from "@/layout/WebAnalytics";

ensureDom();

const userAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");
const serviceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const [key, descriptor] of [
    ["userAgent", userAgent],
    ["serviceWorker", serviceWorker],
  ] as const) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor);
    else Reflect.deleteProperty(navigator, key);
  }
});

describe("native web isolation", () => {
  it.each([undefined, true, false])("loads marketing only for a confirmed web client (%s)", (isNative) => {
    vi.spyOn(NativeShell, "useNativeShell").mockReturnValue(isNative);
    const loadAnalytics = vi.spyOn(Google, "GoogleTagManager").mockReturnValue(<div />);
    render(<WebAnalytics gtmId="GTM-TEST" />);
    expect(loadAnalytics).toHaveBeenCalledTimes(isNative === false ? 1 : 0);
  });

  it("blocks marketing when the native bridge is unavailable", () => {
    vi.spyOn(NativeShell, "useNativeShell").mockReturnValue(false);
    const loadAnalytics = vi.spyOn(Google, "GoogleTagManager").mockReturnValue(<div />);
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "TNR-Native/1.0.0 (android)" });
    render(<WebAnalytics gtmId="GTM-TEST" />);
    expect(loadAnalytics).not.toHaveBeenCalled();
  });

  it("removes only the game's worker in a native session", async () => {
    const removeOwn = vi.fn().mockResolvedValue(true);
    const removeOther = vi.fn().mockResolvedValue(true);
    const register = vi.fn();
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "TNR-Native/1.0.0 (android)" });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register,
        getRegistrations: vi.fn().mockResolvedValue([
          { active: { scriptURL: new URL("/sw.js", location.origin).href }, unregister: removeOwn },
          { active: { scriptURL: new URL("/other-worker.js", location.origin).href }, unregister: removeOther },
        ]),
      },
    });
    render(<PWAManager />);
    await waitFor(() => expect(removeOwn).toHaveBeenCalledTimes(1));
    expect(removeOther).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("preserves web worker registration", async () => {
    const register = vi.fn().mockResolvedValue({ addEventListener: vi.fn() });
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0" });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register } });
    render(<PWAManager />);
    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" }));
  });
});
