import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { fitContent } from "@/libs/native/viewport";

type NativeWindow = Window & { Capacitor?: unknown };
let previous: unknown;
beforeEach(() => {
  previous = (window as NativeWindow).Capacitor;
});
afterEach(() => { (window as NativeWindow).Capacitor = previous; });

describe("Android native viewport", () => {
  it.each([false, true])("fits content and keeps system-bar contrast in dark mode %s", async (darkMode) => {
    const setOverlaysWebView = vi.fn().mockResolvedValue(undefined);
    const setBackgroundColor = vi.fn().mockResolvedValue(undefined);
    const setStyle = vi.fn().mockResolvedValue(undefined);
    (window as NativeWindow).Capacitor = {
      isNativePlatform: () => true, getPlatform: () => "android",
      Plugins: { StatusBar: { setOverlaysWebView, setBackgroundColor, setStyle } },
    };
    await fitContent(darkMode);
    expect(setOverlaysWebView).toHaveBeenCalledWith({ overlay: false });
    expect(setBackgroundColor).toHaveBeenCalledWith({ color: darkMode ? "#000000" : "#ffffff" });
    expect(setStyle).toHaveBeenCalledWith({ style: darkMode ? "DARK" : "LIGHT" });
  });
  it.each(["ios", "web"])("does not alter %s system bars", async (platform) => {
    const setOverlaysWebView = vi.fn();
    (window as NativeWindow).Capacitor = {
      isNativePlatform: () => true, getPlatform: () => platform,
      Plugins: { StatusBar: { setOverlaysWebView } },
    };
    await fitContent();
    expect(setOverlaysWebView).not.toHaveBeenCalled();
  });
  it("keeps the page usable without a bridge or with an unavailable plugin", async () => {
    (window as NativeWindow).Capacitor = undefined;
    await expect(fitContent()).resolves.toBeUndefined();
    (window as NativeWindow).Capacitor = {
      isNativePlatform: () => true, getPlatform: () => "android", Plugins: {},
    };
    await expect(fitContent()).resolves.toBeUndefined();
    (window as NativeWindow).Capacitor = {
      isNativePlatform: () => true, getPlatform: () => "android",
      Plugins: { StatusBar: { setOverlaysWebView: async () => { throw new Error("unavailable"); } } },
    };
    await expect(fitContent()).resolves.toBeUndefined();
  });
});
