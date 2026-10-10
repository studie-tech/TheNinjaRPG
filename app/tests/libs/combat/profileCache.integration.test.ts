// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { item, userData, userItem } from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { captureCombatCacheSnapshot } from "@/libs/combat/userCache";
import { calcBattleResult } from "@/libs/combat/util";
import type { PusherClient } from "@/libs/pusher";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";

describeWithDatabase("combat profile cache inventory confirmation", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, userData);
    await insertUsers([{ userId: "cache-player", username: "CachePlayer", status: "BATTLE", battleId: "cache-fight", rank: "NONE", curEnergy: 10, regeneration: 0 }]);
    await insertItems([{ id: "cache-consumable", itemType: "CONSUMABLE" }]);
    await insertUserItems([{ id: "cache-stack", userId: "cache-player", itemId: "cache-consumable", quantity: 2, equipped: "ITEM_1", durability: 100 }]);
  });

  it.each([{ tombstone: false, quantity: 1 }, { tombstone: true, quantity: 1 }, { tombstone: false, quantity: 2 }, { tombstone: true, quantity: 2 }])("returns an inventory patch only when the stack write confirms its existence (%s)", async ({ tombstone, quantity }) => {
    const database = await getTestDatabase();
    const original = await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player"), with: { items: { with: { item: true } } } });
    if (!original) throw new Error("Missing combat profile");
    const snapshot = captureCombatCacheSnapshot(original);
    const battleItem = { ...original.items[0]!, quantity, dropChancePerc: 0, lastUsedRound: -1, originalCooldown: 0 };
    const state = makeCompleteBattle({ id: "cache-fight", battleType: "ARENA", rewardScaling: 1, usersState: [
      makeBattleUser("cache-player", { direction: "left", rank: "NONE", isAi: false, isSummon: false, curHealth: 100, sector: 1, items: [battleItem] }),
      makeBattleUser("cache-ai", { direction: "right", isAi: true, curHealth: 0, sector: 1, leftBattle: true }),
    ], extraState: { profileCacheSnapshots: { "cache-player": snapshot }, energyCapacity: { "cache-player": 100 }, energyRegeneration: { "cache-player": 0 } } });
    const result = calcBattleResult(state, "cache-player", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    if (tombstone) await database.update(userItem).set({ quantity: 0 }).where(eq(userItem.id, "cache-stack"));
    await updateUser(database, { trigger: async () => {} } as unknown as PusherClient, state, result, "cache-player");
    const savedItem = await database.query.userItem.findFirst({ where: eq(userItem.id, "cache-stack") });
    expect(savedItem?.quantity).toBe(tombstone ? 0 : quantity);
    if (tombstone) expect(result.profileUpdate).toBeUndefined();
    else expect(result.profileUpdate?.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "cache-stack", quantity })]));
    expect((await database.query.userData.findFirst({ where: eq(userData.userId, "cache-player") }))?.battleId).toBeNull();
  });
});
