import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { addNativeListener, getPlatform, invoke, invokeSafe, isNative, NativeBridgeError } from "@/libs/native/bridge";
import * as widgets from "@/libs/native/widgetBridge";

/**
 * The bridge is the one place in `libs/native` that touches `window`, so these assert the
 * off-device behaviour every other module in that directory depends on: never throwing,
 * never assuming the shell is present.
 *
 * Each case swaps `window` to exercise browser, device and server contexts.
 */
type TestWindow = { Capacitor?: unknown };

const setWindow = (value: TestWindow | undefined) => {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value });
};

// The preload installs jsdom's `window` as a configurable, non-writable property, so tests
// redefine it and each test restores the captured descriptor for the next suite.
let saved: PropertyDescriptor | undefined;

beforeEach(() => {
  saved = Object.getOwnPropertyDescriptor(globalThis, "window");
});

afterEach(() => {
  if (saved) Object.defineProperty(globalThis, "window", saved);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("isNative", () => {
  it("is false during SSR and in an ordinary browser", () => {
    setWindow(undefined);
    expect(isNative()).toBe(false);
    setWindow({});
    expect(isNative()).toBe(false);
  });

  it("is true only when the shell says so", () => {
    setWindow({ Capacitor: { isNativePlatform: () => true } });
    expect(isNative()).toBe(true);
    setWindow({ Capacitor: { isNativePlatform: () => false } });
    expect(isNative()).toBe(false);
  });
});

describe("getPlatform", () => {
  it("reports what the shell reports, and web for anything else", () => {
    setWindow({ Capacitor: { getPlatform: () => "ios" } });
    expect(getPlatform()).toBe("ios");
    setWindow({ Capacitor: { getPlatform: () => "android" } });
    expect(getPlatform()).toBe("android");
    // A shell reporting something unexpected must not be treated as a device: it decides
    // which push transport a token is sent to.
    setWindow({ Capacitor: { getPlatform: () => "electron" } });
    expect(getPlatform()).toBe("web");
    setWindow(undefined);
    expect(getPlatform()).toBe("web");
  });
});

describe("invoke", () => {
  it("rejects off-device rather than silently doing nothing", async () => {
    setWindow(undefined);
    await expect(invoke("Haptics", "impact")).rejects.toBeInstanceOf(NativeBridgeError);
  });

  it("rejects when the shell predates the plugin", async () => {
    setWindow({
      Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: {} } },
    });
    await expect(invoke("Haptics", "impact")).rejects.toThrow(/unavailable/);
  });

  it("passes options through and returns the plugin's result", async () => {
    let received: unknown;
    setWindow({
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          Haptics: {
            impact: async (options: unknown) => {
              received = options;
              return { ok: true };
            },
          },
        },
      },
    });
    await expect(invoke("Haptics", "impact", { style: "HEAVY" })).resolves.toEqual({
      ok: true,
    });
    expect(received).toEqual({ style: "HEAVY" });
  });
});

describe("invokeSafe", () => {
  it("resolves to undefined instead of throwing, so call sites need no guard", async () => {
    setWindow(undefined);
    expect(await invokeSafe("Haptics", "impact")).toBeUndefined();

    setWindow({
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          Haptics: {
            impact: async () => {
              throw new Error("boom");
            },
          },
        },
      },
    });
    expect(await invokeSafe("Haptics", "impact")).toBeUndefined();
  });
});

describe("widget ownership mutations", () => {
  it("rejects failed syncs and clears so callers cannot advance ownership", async () => {
    setWindow({
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          TNRWidgetSync: {
            clear: async () => {
              throw new Error("clear failed");
            },
            sync: async () => {
              throw new Error("sync failed");
            },
          },
        },
      },
    });

    await expect(widgets.clear()).rejects.toThrow("clear failed");
    await expect(
      widgets.sync({
        updatedAt: new Date().toISOString(),
        username: "A",
        level: 1,
        curHealth: 1,
        maxHealth: 1,
        curChakra: 1,
        maxChakra: 1,
        curStamina: 1,
        maxStamina: 1,
        unreadNotifications: 0,
      }),
    ).rejects.toThrow("sync failed");
  });
});

describe("addNativeListener", () => {
  it("returns a callable unsubscribe even when nothing was attached", async () => {
    setWindow(undefined);
    const unsubscribe = addNativeListener("App", "backButton", () => undefined);
    expect(await unsubscribe.ready).toBe(false);
    expect(() => unsubscribe()).not.toThrow();
  });

  it("swallows an addListener that rejects", async () => {
    setWindow({
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          App: {
            addListener: () => Promise.reject(new Error("no such event")),
          },
        },
      },
    });
    const unsubscribe = addNativeListener("App", "backButton", () => undefined);
    expect(await unsubscribe.ready).toBe(false);
    expect(() => unsubscribe()).not.toThrow();
  });

  it("removes the listener, including when unsubscribed before it attached", async () => {
    let removed = 0;
    setWindow({
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          App: {
            addListener: async () => ({
              remove: async () => {
                removed += 1;
              },
            }),
          },
        },
      },
    });
    const unsubscribe = addNativeListener("App", "backButton", () => undefined);
    // Unsubscribing while the attach is still in flight is the common case in React:
    // an effect that mounts and unmounts in the same tick.
    unsubscribe();
    expect(await unsubscribe.ready).toBe(false);
    expect(removed).toBe(1);
  });
});
