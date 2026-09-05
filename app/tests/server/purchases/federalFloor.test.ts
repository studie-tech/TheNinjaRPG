import { describe, expect, it } from "vitest";
import type { FederalStatus } from "@/drizzle/constants";
import type { DrizzleClient } from "@/server/db";
import { storeFederalFloor } from "@/server/utils/purchases/grant";

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
