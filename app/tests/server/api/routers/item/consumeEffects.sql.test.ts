import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { REGEN_SECONDS } from "@/drizzle/constants";
import {
  actionLog,
  bloodline,
  bloodlineRolls,
  item,
  sageMode,
  sageModeRolls,
  userData,
  userItem,
} from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { HealTag, RollRandomBloodline, RollRandomSageMode } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "consume-effects-player";
const consumable = {
  itemType: "CONSUMABLE",
  target: "SELF",
  method: "SINGLE",
  destroyOnUse: true,
  preventBattleUsage: true,
} as const;

/** Stored effects are raw JSON, so these reach the router without the tag defaults. */
const stored = (effect: Record<string, unknown>) => effect as never;

const consumeWith = async (effects: unknown[]) => {
  await insertItems([{ id: "consumable", ...consumable, effects: effects as never }]);
  await insertUserItems([{ id: "carried", userId, itemId: "consumable", quantity: 1 }]);
  const api = await callerFor(itemRouter, userId);
  return api.consume({ userItemId: "carried" });
};

const savedUser = async () => {
  const db = await getTestDatabase();
  return (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
};

const carriedStacks = async () => (await getTestDatabase()).select().from(userItem);

describeWithDatabase("item.consume effect planning", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      bloodlineRolls,
      sageModeRolls,
      bloodline,
      sageMode,
      userItem,
      item,
      userData,
    );
    await insertUsers([
      {
        userId,
        username: "ConsumeEffects",
        rank: "JONIN",
        status: "AWAKE",
        regeneration: 0,
        curHealth: 10,
        maxHealth: 200,
        curChakra: 10,
        maxChakra: 33,
        curStamina: 10,
        maxStamina: 100,
      },
    ]);
  });

  describe("heals", () => {
    it("heals a percentage of the maximum and reports the rounded-up gain", async () => {
      const result = await consumeWith([
        HealTag.parse({
          power: 50,
          calculation: "percentage",
          poolsAffected: ["Chakra"],
        }),
      ]);
      expect(result.notifications).toEqual(["You healed 17 CP"]);
      // The pool column is an integer: 26.5 stores as 27.
      expect((await savedUser()).curChakra).toBe(27);
    });

    it("caps each pool at its maximum", async () => {
      const result = await consumeWith([
        HealTag.parse({
          power: 150,
          calculation: "static",
          poolsAffected: ["Stamina", "Health"],
        }),
      ]);
      expect(result.notifications).toEqual(["You healed 90 SP", "You healed 150 HP"]);
      expect(await savedUser()).toMatchObject({
        curStamina: 100,
        curHealth: 160,
        curChakra: 10,
      });
    });

    it("treats a stored effect without a calculation as a flat heal", async () => {
      const result = await consumeWith([
        stored({ type: "heal", power: 25, poolsAffected: ["Health"] }),
      ]);
      expect(result.notifications).toEqual(["You healed 25 HP"]);
      expect((await savedUser()).curHealth).toBe(35);
    });

    it("heals health when a stored effect names no pools", async () => {
      const result = await consumeWith([
        stored({ type: "heal", power: 10, calculation: "percentage" }),
      ]);
      expect(result.notifications).toEqual(["You healed 20 HP"]);
      expect((await savedUser()).curHealth).toBe(30);
    });

    it("computes repeated heals from the snapshot and reports each against the one before", async () => {
      const result = await consumeWith([
        HealTag.parse({ power: 30, calculation: "static", poolsAffected: ["Health"] }),
        HealTag.parse({ power: 10, calculation: "static", poolsAffected: ["Health"] }),
      ]);
      expect(result.notifications).toEqual(["You healed 30 HP", "You healed -20 HP"]);
      expect((await savedUser()).curHealth).toBe(20);
    });

    it("rejects a stored pool outside the tag before consuming the item", async () => {
      await expect(
        consumeWith([stored({ type: "heal", power: 10, poolsAffected: ["Energy"] })]),
      ).rejects.toThrow();
      expect(await carriedStacks()).toHaveLength(1);
    });
  });

  describe("passive regeneration", () => {
    const regenAt = () => new Date(Date.now() - 10.5 * REGEN_SECONDS * 1000);
    const setRegeneration = async (values: Partial<typeof userData.$inferInsert>) =>
      (await getTestDatabase())
        .update(userData)
        .set({ regeneration: 5, curEnergy: 10, ...values })
        .where(eq(userData.userId, userId));

    it("heals the regenerated pools and settles the ticks in the consumption claim", async () => {
      const lastRegen = regenAt();
      await setRegeneration({ regenAt: lastRegen });
      const result = await consumeWith([
        HealTag.parse({ power: 25, calculation: "static", poolsAffected: ["Health"] }),
      ]);
      expect(result.notifications).toEqual(["You healed 25 HP"]);
      const saved = await savedUser();
      // Every pool gained the same ten ticks; Chakra and Stamina did not cap.
      const gain = saved.curStamina - 10;
      expect(gain).toBeGreaterThan(0);
      expect(saved.curChakra).toBe(Math.min(10 + gain, 33));
      expect(saved.curHealth).toBe(10 + gain + 25);
      expect(saved.curEnergy).toBe(Math.min(10 + gain, saved.maxEnergy));
      expect(saved.regenAt.getTime()).toBe(
        lastRegen.getTime() + 10 * REGEN_SECONDS * 1000,
      );
      expect(result.userPatch).toMatchObject({
        curHealth: saved.curHealth,
        curStamina: saved.curStamina,
        regenAt: saved.regenAt,
      });
    });

    it("leaves the account untouched when the item is missing", async () => {
      const lastRegen = regenAt();
      await setRegeneration({ regenAt: lastRegen });
      const before = await savedUser();
      const api = await callerFor(itemRouter, userId);
      expect(await api.consume({ userItemId: "missing" })).toMatchObject({
        success: false,
        message: "User item not found",
      });
      expect(await savedUser()).toEqual(before);
    });

    it("defers regeneration to queued Energy training", async () => {
      const lastRegen = regenAt();
      await setRegeneration({
        regenAt: lastRegen,
        energyQueueHead: 0,
        energyQueueTail: 1,
      });
      const result = await consumeWith([
        HealTag.parse({ power: 25, calculation: "static", poolsAffected: ["Health"] }),
      ]);
      expect(result.success).toBe(true);
      const saved = await savedUser();
      expect(saved).toMatchObject({ curHealth: 35, curStamina: 10, curEnergy: 10 });
      expect(saved.regenAt.getTime()).toBe(lastRegen.getTime());
    });
  });

  describe("bloodline rolls", () => {
    const insertBloodlines = async (...ranks: ("S" | "A" | "B" | "C" | "D")[]) =>
      (await getTestDatabase()).insert(bloodline).values(
        ranks.map((rank) => ({
          id: `bloodline-${rank}`,
          name: `Bloodline ${rank}`,
          image: "https://example.com/bloodline.webp",
          description: "A bloodline",
          rank,
          effects: [],
        })),
      );

    it("rejects before consuming when any rolled rank has an empty pool", async () => {
      await insertBloodlines("A");
      const result = await consumeWith([
        RollRandomBloodline.parse({ rank: "A", power: 100 }),
        RollRandomBloodline.parse({ rank: "B", power: 100 }),
      ]);
      expect(result).toMatchObject({
        success: false,
        message: "No bloodline is available to roll",
      });
      expect(await carriedStacks()).toHaveLength(1);
    });

    it("rejects a stored roll without a rank before consuming", async () => {
      await insertBloodlines("D");
      const result = await consumeWith([stored({ type: "rollbloodline", power: 100 })]);
      expect(result).toMatchObject({
        success: false,
        message: "No bloodline is available to roll",
      });
      expect(await carriedStacks()).toHaveLength(1);
    });

    it("draws each roll from its own rank", async () => {
      await insertBloodlines("A", "B");
      const result = await consumeWith([
        RollRandomBloodline.parse({ rank: "A", power: 100 }),
        RollRandomBloodline.parse({ rank: "B", power: 100 }),
      ]);
      expect(result.notifications).toEqual([
        "You rolled a new bloodline: Bloodline A. ",
        "You rolled a new bloodline: Bloodline B. ",
      ]);
      expect((await savedUser()).bloodlineId).toBe("bloodline-B");
      const rolls = await (await getTestDatabase()).select().from(bloodlineRolls);
      expect(rolls.map((roll) => roll.bloodlineId).sort()).toEqual([
        "bloodline-A",
        "bloodline-B",
      ]);
      expect(await carriedStacks()).toHaveLength(0);
    });

    it("records a failed roll against the goal rank", async () => {
      await insertBloodlines("A");
      const result = await consumeWith([
        RollRandomBloodline.parse({ rank: "A", power: 0 }),
      ]);
      expect(result.notifications).toEqual([
        "You rolled for a new bloodline, but none was found. ",
      ]);
      expect((await savedUser()).bloodlineId).toBeNull();
      const rolls = await (await getTestDatabase()).select().from(bloodlineRolls);
      expect(rolls).toMatchObject([{ goal: "A", bloodlineId: null }]);
    });
  });

  describe("sage mode rolls", () => {
    const insertSageModes = async (...ids: string[]) =>
      (await getTestDatabase()).insert(sageMode).values(
        ids.map((id) => ({
          id,
          name: `Sage ${id}`,
          image: "https://example.com/sage.webp",
          description: "A sage mode",
          level: 1,
        })) as never,
      );

    it("rejects before consuming when no mode can be rolled", async () => {
      const result = await consumeWith([RollRandomSageMode.parse({ power: 100 })]);
      expect(result).toMatchObject({
        success: false,
        message: "No sage mode is available to roll",
      });
      expect(await carriedStacks()).toHaveLength(1);
    });

    it("excludes a mode the player has already rolled from the pool", async () => {
      await insertSageModes("rolled");
      await (await getTestDatabase())
        .insert(sageModeRolls)
        .values({ id: "history", userId, sageModeId: "rolled", used: 1 } as never);
      const result = await consumeWith([RollRandomSageMode.parse({ power: 100 })]);
      expect(result).toMatchObject({
        success: false,
        message: "No sage mode is available to roll",
      });
    });

    it("grants the first successful roll and stops a second effect replacing it", async () => {
      await insertSageModes("granted");
      const result = await consumeWith([
        RollRandomSageMode.parse({ power: 100 }),
        RollRandomSageMode.parse({ power: 100 }),
      ]);
      expect(result.notifications).toEqual([
        "You rolled a new sage mode: Sage granted. ",
        "You already channel a sage mode; the natural energies find no room for another. ",
      ]);
      expect((await savedUser()).sageModeId).toBe("granted");
      expect(await (await getTestDatabase()).select().from(sageModeRolls)).toHaveLength(
        1,
      );
    });

    it("lets a later effect roll again after a failed roll", async () => {
      await insertSageModes("granted");
      const result = await consumeWith([
        RollRandomSageMode.parse({ power: 0 }),
        RollRandomSageMode.parse({ power: 100 }),
      ]);
      expect(result.notifications).toEqual([
        "You rolled for a new sage mode, but none was found. ",
        "You rolled a new sage mode: Sage granted. ",
      ]);
      expect((await savedUser()).sageModeId).toBe("granted");
    });

    it("skips the pool check for a player who already channels a mode", async () => {
      await (await getTestDatabase())
        .update(userData)
        .set({ sageModeId: "owned" })
        .where(eq(userData.userId, userId));
      const result = await consumeWith([
        RollRandomSageMode.parse({ power: 100 }),
        HealTag.parse({ power: 5, calculation: "static", poolsAffected: ["Health"] }),
      ]);
      expect(result.notifications).toEqual([
        "You already channel a sage mode; the natural energies find no room for another. ",
        "You healed 5 HP",
      ]);
      expect((await savedUser()).sageModeId).toBe("owned");
    });
  });
});
