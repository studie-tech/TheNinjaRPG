// @vitest-environment node

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bloodline, bloodlineRolls, item, userData, userItem } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import * as arrayUtils from "@/utils/array";
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

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { power: 25, selection: 0, roll: 0.249999, expected: "a" },
    { power: 25, selection: 0.999999, roll: 0.249999, expected: "b" },
    { power: 25, selection: 0, roll: 0.25, expected: null },
    { power: 0, selection: 0, roll: 0, expected: null },
    { power: 100, selection: 0.999999, roll: 0.999999, expected: "b" },
  ])(
    "matches consumption at probability boundaries: $power / $selection / $roll",
    async ({ power, selection, roll, expected }) => {
      const database = await getTestDatabase();
      await database.insert(bloodline).values(
        ["a", "b"].map((id) => ({
          id,
          name: id,
          image: "/bloodline.png",
          description: "",
          effects: [],
          rank: "D" as const,
        })),
      );
      await database
        .update(item)
        .set({ effects: [RollRandomBloodline.parse({ rank: "D", power })] })
        .where(eq(item.id, "roll-item"));
      await insertUserItems([
        { id: "owned-roll", userId: "odds-user", itemId: "roll-item", quantity: 2 },
      ]);
      const api = await callerFor(itemRouter, "odds-user");
      const [odds] = (await api.getBloodlineRollOdds({ id: "roll-item" }))!;
      expect(odds?.successChance).toBe(power);
      expect(odds?.outcomes.map((outcome) => outcome.chance)).toEqual([
        power / 2,
        power / 2,
      ]);
      const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
      const getRandomElement = arrayUtils.getRandomElement;
      // Start the controlled draws at item selection, after request middleware runs.
      vi.spyOn(arrayUtils, "getRandomElement").mockImplementation((pool) => {
        random.mockReturnValueOnce(selection).mockReturnValue(roll);
        return getRandomElement(pool);
      });
      expect(await api.consume({ userItemId: "owned-roll" })).toMatchObject({
        success: true,
      });
      random.mockRestore();
      const [user] = await database
        .select()
        .from(userData)
        .where(eq(userData.userId, "odds-user"));
      expect(user?.bloodlineId).toBe(expected);
      const [nextOdds] = (await api.getBloodlineRollOdds({ id: "roll-item" }))!;
      expect(nextOdds?.outcomes.map((outcome) => outcome.id)).toEqual(
        expected ? [expected === "a" ? "b" : "a"] : ["a", "b"],
      );
      expect(
        nextOdds?.outcomes.every(
          (outcome) => outcome.chance === (expected ? power : power / 2),
        ),
      ).toBe(true);
    },
  );

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
