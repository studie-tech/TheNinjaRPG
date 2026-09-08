import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The bridge is the one place in `libs/native` that touches `window`, so these assert the
 * off-device behaviour every other module in that directory depends on: never throwing,
 * never assuming the shell is present.
 *
 * `window` is assigned directly rather than through jsdom, which this runner does not have.
 */
type TestWindow = { Capacitor?: unknown };

const setWindow = (value: TestWindow | undefined) => {
  if (value === undefined) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }
  (globalThis as { window?: unknown }).window = value;
};

// Put the realm back exactly as each test found it, rather than leaving it cleared. These
// files share one process and there is no `window` in the base realm, so whichever file
// creates one is providing it for everybody: deleting it unconditionally stranded every
// test that ran after this one, and they failed in files that never mention the bridge.
let saved: { present: boolean; value: unknown };

beforeEach(() => {
  saved = {
    present: "window" in globalThis,
    value: (globalThis as { window?: unknown }).window,
  };
});

afterEach(() => {
  if (saved.present) {
    // Assignment, not defineProperty: the property these tests overwrite is an ordinary
    // writable one, and restoring a captured descriptor would freeze it for the next test.
    (globalThis as { window?: unknown }).window = saved.value;
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
});

// Imported fresh per test: the module reads `window` lazily, so no cache busting is
// needed, but each test still starts from a known global.
const load = () => import("@/libs/native/bridge");

describe("isNative", () => {
  it("is false during SSR and in an ordinary browser", async () => {
    const { isNative } = await load();
    setWindow(undefined);
    expect(isNative()).toBe(false);
    setWindow({});
    expect(isNative()).toBe(false);
  });

  it("is true only when the shell says so", async () => {
    const { isNative } = await load();
    setWindow({ Capacitor: { isNativePlatform: () => true } });
    expect(isNative()).toBe(true);
    setWindow({ Capacitor: { isNativePlatform: () => false } });
    expect(isNative()).toBe(false);
  });
});

describe("getPlatform", () => {
  it("reports what the shell reports, and web for anything else", async () => {
    const { getPlatform } = await load();
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
    const { invoke, NativeBridgeError } = await load();
    setWindow(undefined);
    await expect(invoke("Haptics", "impact")).rejects.toBeInstanceOf(NativeBridgeError);
  });

  it("rejects when the shell predates the plugin", async () => {
    const { invoke } = await load();
    setWindow({
      Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: {} } },
    });
    await expect(invoke("Haptics", "impact")).rejects.toThrow(/unavailable/);
  });

  it("passes options through and returns the plugin's result", async () => {
    const { invoke } = await load();
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
    const { invokeSafe } = await load();
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
    const widgets = await import("@/libs/native/widgetBridge");

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
    const { addNativeListener } = await load();
    setWindow(undefined);
    expect(() => addNativeListener("App", "backButton", () => undefined)()).not.toThrow();
  });

  it("swallows an addListener that rejects", async () => {
    const { addNativeListener } = await load();
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
    // The rejection is handled inside the bridge; nothing reaches the caller and no
    // unhandled rejection is produced.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(() => unsubscribe()).not.toThrow();
  });

  it("removes the listener, including when unsubscribed before it attached", async () => {
    const { addNativeListener } = await load();
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
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(removed).toBe(1);
  });
});
