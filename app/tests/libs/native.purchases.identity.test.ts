import { describe, expect, it } from "vitest";
import {
  runPurchaseIdentityOperation,
  syncPurchaseIdentitySnapshot,
} from "@/libs/native/purchases";

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
});
