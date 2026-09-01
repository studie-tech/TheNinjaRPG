import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runPurchaseIdentityOperation,
  syncPurchaseIdentitySnapshot,
} from "@/libs/native/purchases";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();

const capacitorWindow = window as typeof window & {
  Capacitor?: {
    isNativePlatform: () => boolean;
    Plugins: Record<string, Record<string, unknown>>;
  };
};

afterEach(() => {
  delete capacitorWindow.Capacitor;
});

describe("RevenueCat identity queue", () => {
  it("keeps sync and its customer-info read ahead of logout and account rebind", async () => {
    const events: string[] = [];
    let finishSync: (() => void) | undefined;
    const sync = syncPurchaseIdentitySnapshot(
      async () => {
        events.push("sync:start");
        await new Promise<void>((resolve) => {
          finishSync = resolve;
        });
        events.push("sync:end");
      },
      async () => {
        events.push("customer-info:a");
        return { originalAppUserId: "player-a" };
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["sync:start"]);

    const rebind = runPurchaseIdentityOperation(async () => {
      events.push("rebind:b");
    });
    const logout = runPurchaseIdentityOperation(async () => {
      events.push("logout");
    });
    await Promise.resolve();
    expect(events).toEqual(["sync:start"]);

    finishSync?.();
    await Promise.all([sync, rebind, logout]);
    expect(events).toEqual([
      "sync:start",
      "sync:end",
      "customer-info:a",
      "rebind:b",
      "logout",
    ]);
  });

  it("configures once after a retryable failure and logs in for every later bind", async () => {
    // Use a fresh module singleton so this assertion is valid even when Vitest runs files
    // in one non-isolated worker after a NativeStore suite already configured RevenueCat.
    vi.resetModules();
    const { bind } = await import("@/libs/native/purchases");
    const configure = vi
      .fn()
      .mockRejectedValueOnce(new Error("SDK unavailable"))
      .mockResolvedValue(undefined);
    const logIn = vi.fn().mockResolvedValue(undefined);
    const isConfigured = vi.fn().mockResolvedValue({ isConfigured: false });
    capacitorWindow.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        Purchases: {
          isConfigured,
          configure,
          logIn,
          getOfferings: vi.fn().mockResolvedValue({
            current: { availablePackages: [] },
          }),
          getCustomerInfo: vi.fn().mockResolvedValue({
            customerInfo: {
              entitlements: { active: {} },
              activeSubscriptions: [],
              originalAppUserId: "player-a",
            },
          }),
        },
      },
    };

    await expect(bind("ios-key", "player-a")).rejects.toThrow("SDK unavailable");
    await expect(bind("ios-key", "player-a")).resolves.toMatchObject({
      packages: [],
    });
    await expect(bind("ios-key", "player-b")).resolves.toMatchObject({
      packages: [],
    });

    expect(configure).toHaveBeenCalledTimes(2);
    expect(isConfigured).toHaveBeenCalledTimes(2);
    expect(logIn).toHaveBeenNthCalledWith(1, { appUserID: "player-a" });
    expect(logIn).toHaveBeenNthCalledWith(2, { appUserID: "player-b" });
  });
});
