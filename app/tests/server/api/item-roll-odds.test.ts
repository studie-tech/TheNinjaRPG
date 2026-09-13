// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { bloodline, bloodlineRolls, item, userData, userItem } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { RollRandomBloodline } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("bloodline item odds", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, bloodlineRolls, bloodline, userData);
    await insertUsers([{ userId: "odds-user", status: "AWAKE", villageId: "home" }]);
    await insertItems([{
      id: "roll-item", itemType: "CONSUMABLE",
      effects: [RollRandomBloodline.parse({ rank: "D", power: 25 })],
    }]);
  });

  it("discloses only visible, village-compatible, least-rolled outcomes", async () => {
    const database = await getTestDatabase();
    await database.insert(bloodline).values([
      { id: "a", name: "A" }, { id: "b", name: "B" },
      { id: "rolled", name: "Rolled" },
      { id: "away", name: "Away", villageId: "away" },
      { id: "hidden", name: "Hidden", hidden: true },
      { id: "rank", name: "Rank", rank: "C" as const },
    ].map((row) => ({ image: "/bloodline.png", description: "", effects: [], rank: "D" as const, ...row })));
    await database.insert(bloodlineRolls).values({
      id: "history", userId: "odds-user", bloodlineId: "rolled", type: "ITEM", used: 1,
    });
    const api = await callerFor(itemRouter, "odds-user");
    const odds = await api.getBloodlineRollOdds({ id: "roll-item" });
    expect(odds).toEqual([{
      rank: "D", successChance: 25,
      outcomes: [{ id: "a", name: "A", chance: 12.5 }, { id: "b", name: "B", chance: 12.5 }],
    }]);
  });

  it("preserves the item when no bloodline can be rolled", async () => {
    await insertUserItems([{ id: "owned-roll", userId: "odds-user", itemId: "roll-item", quantity: 2 }]);
    const api = await callerFor(itemRouter, "odds-user");
    expect(await api.consume({ userItemId: "owned-roll" })).toMatchObject({
      success: false, message: "No bloodline is available to roll",
    });
    const database = await getTestDatabase();
    const [owned] = await database.select().from(userItem).where(eq(userItem.id, "owned-roll"));
    expect(owned?.quantity).toBe(2);
    expect(await api.getBloodlineRollOdds({ id: "roll-item" })).toEqual([
      { rank: "D", successChance: 25, outcomes: [] },
    ]);
  });
});
