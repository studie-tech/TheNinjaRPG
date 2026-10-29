import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { purchasesRouter } from "@/server/api/routers/purchases";
import { getPurchaseUserUpdate } from "@/server/utils/purchases/cache";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("purchase balance confirmation", () => {
  beforeEach(async () => {
    await resetTables(userData);
    await insertUsers([
      { userId: "buyer", money: 10, reputationPoints: 20, reputationPointsTotal: 40, federalStatus: "GOLD" },
      { userId: "recipient", reputationPoints: 500 },
    ]);
  });
  it("returns only the signed-in account's saved balances for every reconciliation", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(purchasesRouter, "buyer");
    const first = await caller.userSnapshot();
    expect(first).toEqual({ userId: "buyer", userPatch: { money: 10, reputationPoints: 20, reputationPointsTotal: 40, federalStatus: "GOLD" } });
    await db.update(userData).set({ reputationPoints: 28, reputationPointsTotal: 48, federalStatus: "NONE" }).where(eq(userData.userId, "buyer"));
    expect(await caller.userSnapshot()).toMatchObject({ userPatch: { reputationPoints: 28, reputationPointsTotal: 48, federalStatus: "NONE" } });
    expect(await getPurchaseUserUpdate(db, "buyer")).toEqual({ userPatch: (await caller.userSnapshot()).userPatch ?? undefined, userDelta: {} });
  });
  it("reports a missing character without inventing a balance", async () => {
    const db = await getTestDatabase();
    await db.delete(userData).where(eq(userData.userId, "buyer"));
    expect(await (await callerFor(purchasesRouter, "buyer")).userSnapshot()).toEqual({ userId: "buyer", userPatch: null });
  });
});
