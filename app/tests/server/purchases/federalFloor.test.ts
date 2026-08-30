import { describe, expect, it } from "vitest";
import type { FederalStatus } from "@/drizzle/constants";
import type { DrizzleClient } from "@/server/db";
import {
  federalStatusWithStoreFloor,
  storeFederalFloor,
} from "@/server/utils/purchases/grant";

/**
 * Just enough client for the one read these helpers make. `revoked` receipts are filtered
 * out in SQL, so a stub that returns only live ones is the honest shape.
 */
const stub = (live: (FederalStatus | null)[]) =>
  ({
    query: {
      storePurchase: {
        findMany: async () => live.map((federalStatus) => ({ federalStatus })),
      },
    },
  }) as unknown as DrizzleClient;

describe("storeFederalFloor", () => {
  it("vouches for the highest tier a live receipt shows", async () => {
    expect(await storeFederalFloor(stub(["NORMAL", "GOLD", "SILVER"]), "u")).toBe("GOLD");
  });

  it("vouches for nothing once the receipts are retired", async () => {
    // revokeFederalStatus stamps revokedAt, so the query returns no rows at all.
    expect(await storeFederalFloor(stub([]), "u")).toBe("NONE");
  });

  it("ignores reputation bundles, which carry no tier", async () => {
    expect(await storeFederalFloor(stub([null]), "u")).toBe("NONE");
  });
});

describe("federalStatusWithStoreFloor", () => {
  it("leaves a live store subscription alone when PayPal decides NONE", async () => {
    expect(await federalStatusWithStoreFloor(stub(["GOLD"]), "u", "NONE")).toBe("GOLD");
  });

  it("still expires a player whose only source was PayPal", async () => {
    expect(await federalStatusWithStoreFloor(stub([]), "u", "NONE")).toBe("NONE");
  });

  it("lets PayPal raise the tier above the store's", async () => {
    expect(await federalStatusWithStoreFloor(stub(["SILVER"]), "u", "GOLD")).toBe("GOLD");
  });

  it("takes the tier away once the store subscription has been revoked too", async () => {
    // The case the earlier clamp got wrong: with both sources finished, nothing should
    // hold the tier open just because a spent receipt is still inside the window.
    expect(await federalStatusWithStoreFloor(stub([]), "u", "NONE")).toBe("NONE");
  });
});
