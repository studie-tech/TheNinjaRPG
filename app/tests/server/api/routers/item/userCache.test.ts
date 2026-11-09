import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  item,
  skillTree,
  userCookingJob,
  userData,
  userItem,
  userQueue,
  userRaidBuff,
  userSkill,
  userVote,
} from "@/drizzle/schema";
import { getInventoryQuantities } from "@/deltas/item";
import { itemRouter } from "@/server/api/routers/item";
import { profileRouter } from "@/server/api/routers/profile";
import {
  HealTag,
  IncreaseJutsuSlots,
  IncreaseRegenerationTag,
  NonCombatGainSkill,
} from "@/validators/combat";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "consume-cache-player";
const key = [["profile", "getUser"], { type: "query" }];
describeWithDatabase("confirmed consumption profile updates", () => {
  beforeEach(async () => {
    await resetTables(
      userCookingJob,
      userSkill,
      skillTree,
      userRaidBuff,
      userQueue,
      userItem,
      item,
      userVote,
      userData,
    );
    await insertUsers([
      {
        userId,
        username: "ConsumeCache",
        rank: "JONIN",
        primaryElement: "Fire",
        secondaryElement: "Water",
        status: "AWAKE",
        regeneration: 0,
        curHealth: 10,
        maxHealth: 100,
        curChakra: 10,
        maxChakra: 100,
        curStamina: 10,
        maxStamina: 100,
      },
    ]);
    await insertItems([
      {
        id: "heal",
        itemType: "CONSUMABLE",
        target: "SELF",
        method: "SINGLE",
        destroyOnUse: true,
        preventBattleUsage: true,
        effects: [
          HealTag.parse({
            power: 10,
            calculation: "static",
            poolsAffected: ["Health", "Chakra", "Stamina"],
          }),
        ],
      },
      {
        id: "slot",
        itemType: "CONSUMABLE",
        target: "SELF",
        method: "SINGLE",
        destroyOnUse: true,
        preventBattleUsage: true,
        effects: [IncreaseJutsuSlots.parse({})],
      },
      {
        id: "meal",
        ...MEAL_ITEM_DEFAULTS,
        itemType: "MEAL",
        mealDurationSeconds: 120,
        effects: [IncreaseRegenerationTag.parse({ power: 20, calculation: "static" })],
      },
      {
        id: "skill",
        itemType: "CONSUMABLE",
        target: "SELF",
        method: "SINGLE",
        destroyOnUse: true,
        preventBattleUsage: true,
        effects: [NonCombatGainSkill.parse({ skillId: "unlocked-skill" })],
      },
    ]);
    await (await getTestDatabase()).insert(skillTree).values({
      id: "unlocked-skill",
      name: "Unlocked skill",
      image: "https://example.com/skill.webp",
      description: "An unlockable skill",
      effects: [],
    });
  });
  it.each([
    { itemId: "heal", equipped: "NONE" },
    { itemId: "heal", equipped: "ITEM_1" },
    { itemId: "slot", equipped: "NONE" },
    { itemId: "meal", equipped: "NONE" },
    { itemId: "skill", equipped: "NONE" },
    { itemId: "heal", equipped: "NONE", pendingCooking: true },
    { itemId: "meal", equipped: "NONE", pendingCooking: true },
    { itemId: "meal", equipped: "NONE", newRegeneration: 10 },
  ] as const)(
    "applies confirmed $itemId ($equipped) and current progression without a getUser fetch",
    async (fixture) => {
      const { itemId, equipped } = fixture;
      const db = await getTestDatabase();
      await insertUserItems([{ id: "carried", userId, itemId, equipped, quantity: 2 }]);
      const inventory = await (await callerFor(itemRouter, userId)).getUserItems();
      const profile = await (await callerFor(profileRouter, userId)).getUser();
      if ("pendingCooking" in fixture)
        await db.insert(userCookingJob).values({
          id: "completed-cooking",
          userId,
          experience: 23,
          finishesAt: new Date(Date.now() - 1000),
        });
      if ("newRegeneration" in fixture)
        await db
          .update(userData)
          .set({ regeneration: fixture.newRegeneration })
          .where(eq(userData.userId, userId));
      const client = new QueryClient();
      client.setQueryData(key, profile);
      let reads = 0;
      const observer = new QueryObserver(client, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: async () => {
          reads++;
          return profile;
        },
      });
      const stop = observer.subscribe(() => undefined);
      try {
        const revision = prepareUserUpdate(client, key);
        const result = await (await callerFor(itemRouter, userId)).consume({
          userItemId: "carried",
          expectedQuantity: 2,
        });
        expect(result.success).toBe(true);
        expect(result.userPatch).toBeDefined();
        expect(result.userDelta).toEqual({});
        expect(
          getInventoryQuantities(inventory, result.inventoryChanges)?.map(
            ({ id, itemId, quantity }) => ({ id, itemId, quantity }),
          ),
        ).toEqual(
          (await (await callerFor(itemRouter, userId)).getUserItems()).map(
            ({ id, itemId, quantity }) => ({ id, itemId, quantity }),
          ),
        );
        expect(result.bloodlineRollsChanged).toBe(false);
        expect(result.raidBuffsChanged).toBe(itemId === "meal");
        await updateUserCache(client, key, result.userPatch, {
          revision,
          delta: result.userDelta,
          achievementProgress: result.achievementProgress,
        });
        const saved = (await db.query.userData.findFirst({
          where: eq(userData.userId, userId),
        }))!;
        const cached = client.getQueryData<typeof profile>(key)!.userData!;
        expect(cached).toMatchObject({
          curHealth: saved.curHealth,
          curChakra: saved.curChakra,
          curStamina: saved.curStamina,
          extraJutsuSlots: saved.extraJutsuSlots,
        });
        expect(cached.cookingExperience).toBe(saved.cookingExperience);
        expect(cached.cookingJobs).toEqual(await db.query.userCookingJob.findMany());
        if (equipped !== "NONE")
          expect(cached.items.find((entry) => entry.id === "carried")?.quantity).toBe(
            1,
          );
        if (itemId === "meal") {
          expect(cached.raidBuffs).toEqual(await db.query.userRaidBuff.findMany());
          expect(cached.regeneration).toBe(
            (profile.userData?.regeneration ?? 0) +
              20 +
              ("newRegeneration" in fixture ? (fixture.newRegeneration ?? 0) : 0),
          );
        }
        if ("pendingCooking" in fixture) expect(saved.cookingExperience).toBe(23);
        if ("newRegeneration" in fixture) {
          const refreshed = await (await callerFor(profileRouter, userId)).getUser();
          expect(cached.regenerationWithoutTimedBuffs).toBe(
            refreshed.userData?.regenerationWithoutTimedBuffs,
          );
          expect(cached.regenerationWithoutTimedBuffs).not.toBe(
            profile.userData?.regenerationWithoutTimedBuffs,
          );
        }
        if (itemId === "skill") {
          expect(
            await db.query.userSkill.findMany({ where: eq(userSkill.userId, userId) }),
          ).toMatchObject([{ skillId: "unlocked-skill", activated: false }]);
          const refreshed = await (await callerFor(profileRouter, userId)).getUser();
          expect(cached.userSkills).toEqual(refreshed.userData!.userSkills);
          expect(cached.userSkills).toEqual([]);
        }
        expect(reads).toBe(0);
      } finally {
        stop();
        client.clear();
      }
    },
  );
});
