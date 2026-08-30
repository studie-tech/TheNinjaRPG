import { describe, expect, it } from "vitest";
import type { FederalStatus } from "@/drizzle/constants";
import type { DrizzleClient } from "@/server/db";
import {
  federalStatusWithStoreFloor,
  storeFederalFloor,
} from "@/server/utils/purchases/grant";

/** Just enough client for the two reads these helpers make. */
const stub = (opts: {
  current?: FederalStatus | null;
  purchases?: (FederalStatus | null)[];
}) =>
  ({
    query: {
      userData: {
        findFirst: async () =>
          opts.current === null ? undefined : { federalStatus: opts.current ?? "NONE" },
      },
      storePurchase: {
        findMany: async () =>
          (opts.purchases ?? []).map((federalStatus) => ({ federalStatus })),
      },
    },
  }) as unknown as DrizzleClient;

describe("storeFederalFloor", () => {
  it("vouches for the highest tier the stores still show a receipt for", async () => {
    const floor = await storeFederalFloor(
      stub({ purchases: ["NORMAL", "GOLD", "SILVER"] }),
      "u",
      "GOLD",
    );
    expect(floor).toBe("GOLD");
  });

  it("cannot resurrect a tier that was revoked", async () => {
    // The subscription expired, revokeFederalStatus dropped the player to NONE, but the
    // receipt for the last renewal is still inside the window.
    const floor = await storeFederalFloor(stub({ purchases: ["GOLD"] }), "u", "NONE");
    expect(floor).toBe("NONE");
  });

  it("never claims more than the player currently holds", async () => {
    const floor = await storeFederalFloor(stub({ purchases: ["GOLD"] }), "u", "NORMAL");
    expect(floor).toBe("NORMAL");
  });

  it("is NONE for a player with no federal store purchases", async () => {
    expect(await storeFederalFloor(stub({ purchases: [] }), "u", "GOLD")).toBe("NONE");
    // Reputation bundles carry a null federalStatus and must not hold a tier open.
    expect(await storeFederalFloor(stub({ purchases: [null] }), "u", "GOLD")).toBe("NONE");
  });
});

describe("federalStatusWithStoreFloor", () => {
  it("leaves a store subscription alone when PayPal decides NONE", async () => {
    const next = await federalStatusWithStoreFloor(
      stub({ current: "GOLD", purchases: ["GOLD"] }),
      "u",
      "NONE",
    );
    expect(next).toBe("GOLD");
  });

  it("still expires a player whose only source was PayPal", async () => {
    const next = await federalStatusWithStoreFloor(
      stub({ current: "NORMAL", purchases: [] }),
      "u",
      "NONE",
    );
    expect(next).toBe("NONE");
  });

  it("lets PayPal raise the tier above the store's", async () => {
    const next = await federalStatusWithStoreFloor(
      stub({ current: "SILVER", purchases: ["SILVER"] }),
      "u",
      "GOLD",
    );
    expect(next).toBe("GOLD");
  });

  it("does not re-grant a store tier that was already revoked", async () => {
    const next = await federalStatusWithStoreFloor(
      stub({ current: "NONE", purchases: ["GOLD"] }),
      "u",
      "NONE",
    );
    expect(next).toBe("NONE");
  });
});
