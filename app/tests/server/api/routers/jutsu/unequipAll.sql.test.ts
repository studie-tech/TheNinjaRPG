import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { jutsu, jutsuLoadout, userData, userJutsu } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertJutsus, insertUsers, jutsuRow } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "unequip-all-owner";
const otherId = "unequip-all-other";

const loadoutIds = async (id: string) =>
  (
    await (
      await getTestDatabase()
    ).query.jutsuLoadout.findFirst({ where: eq(jutsuLoadout.id, id) })
  )?.jutsuIds;

describeWithDatabase("jutsu unequip all", () => {
  beforeEach(async () => {
    await resetTables(jutsuLoadout, userJutsu, jutsu, userData);
    await insertUsers([
      { userId, username: "UnequipOwner", status: "AWAKE", jutsuLoadout: "active" },
      { userId: otherId, username: "UnequipOther", jutsuLoadout: "foreign" },
    ]);
    await insertJutsus([jutsuRow("strike"), jutsuRow("guard")]);
    const db = await getTestDatabase();
    await db.insert(jutsuLoadout).values([
      { id: "active", userId, jutsuIds: ["strike", "guard"] },
      { id: "spare", userId, jutsuIds: ["strike"] },
      { id: "foreign", userId: otherId, jutsuIds: ["strike"] },
    ]);
    await db.insert(userJutsu).values([
      { id: "owned-strike", userId, jutsuId: "strike", equipped: true },
      { id: "owned-guard", userId, jutsuId: "guard", equipped: true },
      { id: "other-strike", userId: otherId, jutsuId: "strike", equipped: true },
    ]);
  });

  it("empties only the active loadout and patches the profile loadout", async () => {
    const result = await (await callerFor(jutsuRouter, userId)).unequipAll();
    expect(result).toMatchObject({
      success: true,
      userPatch: { loadout: { jutsuIds: [] } },
    });
    expect(await loadoutIds("active")).toEqual([]);
    expect(await loadoutIds("spare")).toEqual(["strike"]);
    expect(await loadoutIds("foreign")).toEqual(["strike"]);
    const rows = await (await getTestDatabase()).query.userJutsu.findMany();
    expect(Object.fromEntries(rows.map((row) => [row.id, row.equipped]))).toEqual({
      "owned-strike": false,
      "owned-guard": false,
      "other-strike": true,
    });
  });

  it("confirms an empty change when no active loadout is selected", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ jutsuLoadout: null })
      .where(eq(userData.userId, userId));
    const result = await (await callerFor(jutsuRouter, userId)).unequipAll();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toEqual({});
    expect(await loadoutIds("active")).toEqual(["strike", "guard"]);
  });
});
