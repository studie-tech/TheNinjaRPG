import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  badge,
  bloodline,
  bloodlineRolls,
  item,
  jutsu,
  quest,
  raidDamageThreshold,
  raidParticipation,
  sageMode,
  sageModeRolls,
  userBadge,
  userData,
  userItem,
  userJutsu,
  userVote,
} from "@/drizzle/schema";
import { raidsRouter } from "@/server/api/routers/raids";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuests,
  insertUsers,
  insertJutsus,
  insertUserVotes,
} from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("raid reward display from confirmed grants", () => {
  beforeEach(async () => {
    stubRateLimitTransport({ answerOtherRequests: true });
    await resetTables(
      userItem,
      userJutsu,
      userBadge,
      bloodlineRolls,
      sageModeRolls,
      raidParticipation,
      raidDamageThreshold,
      userVote,
      userData,
      quest,
      item,
      jutsu,
      badge,
      bloodline,
      sageMode,
    );
    await insertUsers([
      {
        userId: "raid-reward-user",
        username: "RaidReward",
        rank: "JONIN",
        primaryElement: "Fire",
        secondaryElement: "Water",
        isOutlaw: true,
        regeneration: 0,
      },
    ]);
    await insertQuests([{ id: "reward-raid", questType: "raid" }]);
    await insertItems([
      { id: "reward-item-a", name: "Potion A", canStack: true, stackSize: 10 },
      { id: "reward-item-b", name: "Potion B" },
    ]);
    const database = await getTestDatabase();
    await insertJutsus([
      {
        id: "reward-jutsu",
        name: "Reward Jutsu",
        description: "Test",
        image: "/test.png",
        target: "CHARACTER",
        range: 1,
        battleDescription: "Test",
      },
    ]);
    await database.insert(bloodline).values({
      id: "reward-bloodline",
      name: "Reward Bloodline",
      description: "Test",
      image: "/test.png",
      effects: [],
      rank: "D",
    });
    await database.insert(badge).values({
      id: "reward-badge",
      name: "Reward Badge",
      description: "Test",
      image: "/test.png",
    });
    await insertUserVotes([{ userId: "raid-reward-user" }]);
    await database.insert(raidParticipation).values({
      id: "reward-participation",
      questId: "reward-raid",
      userId: "raid-reward-user",
      damageDealt: 100,
    });
    await database.insert(raidDamageThreshold).values({
      id: "reward-threshold",
      questId: "reward-raid",
      damageRequired: 50,
      rewards: ObjectiveReward.parse({
        reward_items: [
          { ids: ["reward-item-b", "reward-item-a"], number: 100 },
          { ids: ["reward-item-a"], number: 100 },
        ],
        reward_jutsus: ["reward-jutsu"],
        reward_bloodlines: ["reward-bloodline"],
        reward_badges: ["reward-badge"],
      }),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])(
    "names only the sage mode the payout granted (equipped=%s)",
    async (equipped) => {
      const database = await getTestDatabase();
      await database.insert(sageMode).values({
        id: "reward-sage",
        name: "Reward Sage",
        description: "Test",
        image: "/test.png",
      });
      await database
        .update(raidDamageThreshold)
        .set({ rewards: ObjectiveReward.parse({ reward_sage_modes: ["reward-sage"] }) })
        .where(eq(raidDamageThreshold.id, "reward-threshold"));
      if (equipped) {
        await database
          .update(userData)
          .set({ sageModeId: "worn-sage" })
          .where(eq(userData.userId, "raid-reward-user"));
      }
      const api = await callerFor(raidsRouter, "raid-reward-user");
      const result = await api.claimDamageReward({
        questId: "reward-raid",
        thresholdId: "reward-threshold",
      });
      expect(result).toMatchObject({
        success: true,
        rewards: { reward_sage_modes: equipped ? [] : ["Reward Sage"] },
      });
    },
  );

  it.each([false, true])(
    "reuses granted names, preserves item order and quantity, and skips owned content (owned=%s)",
    async (owned) => {
      const database = await getTestDatabase();
      if (owned) {
        await database.insert(userJutsu).values({
          id: "owned-jutsu",
          userId: "raid-reward-user",
          jutsuId: "reward-jutsu",
        });
        await database.insert(bloodlineRolls).values({
          id: "owned-bloodline",
          userId: "raid-reward-user",
          bloodlineId: "reward-bloodline",
          type: "QUEST",
        });
        await database
          .insert(userBadge)
          .values({ userId: "raid-reward-user", badgeId: "reward-badge" });
      }
      const rereads = [
        database.query.item,
        database.query.jutsu,
        database.query.badge,
      ].map((table) =>
        vi
          .spyOn(table, "findMany")
          .mockRejectedValue(new Error("Content names were already loaded by payout")),
      );
      const catalogueReads = vi.spyOn(database.query.bloodline, "findMany");
      // The opening profile read loads collection metadata without rereading reward names.
      const catalogueQuery = {
        columns: { id: true, rank: true, hidden: true },
        where: eq(bloodline.hidden, false),
      };
      const api = await callerFor(raidsRouter, "raid-reward-user");
      const result = await api.claimDamageReward({
        questId: "reward-raid",
        thresholdId: "reward-threshold",
      });
      expect(result).toMatchObject({
        success: true,
        userDelta: undefined,
        userPatch: undefined,
        rewards: {
          reward_items: ["Potion B", "Potion A", "Potion A"],
          reward_jutsus: owned ? [] : ["Reward Jutsu"],
          reward_bloodlines: owned ? [] : ["Reward Bloodline"],
          reward_badges: owned ? [] : ["Reward Badge"],
        },
      });
      for (const reread of rereads) expect(reread).not.toHaveBeenCalled();
      // Content rewards leave collection progression for canonical reconciliation.
      expect(catalogueReads.mock.calls).toEqual([[catalogueQuery]]);
      const inventory = await database.query.userItem.findMany({
        where: eq(userItem.userId, "raid-reward-user"),
      });
      expect(inventory.reduce((sum, row) => sum + row.quantity, 0)).toBe(3);
      expect(
        await database.query.userJutsu.findMany({
          where: eq(userJutsu.userId, "raid-reward-user"),
        }),
      ).toHaveLength(1);
      expect(
        (
          await api.claimDamageReward({
            questId: "reward-raid",
            thresholdId: "reward-threshold",
          })
        ).success,
      ).toBe(false);
      expect(
        (
          await database.query.userItem.findMany({
            where: eq(userItem.userId, "raid-reward-user"),
          })
        ).reduce((sum, row) => sum + row.quantity, 0),
      ).toBe(3);
      for (const reread of rereads) expect(reread).not.toHaveBeenCalled();
      expect(catalogueReads.mock.calls).toEqual(
        Array.from({ length: 2 }, () => [catalogueQuery]),
      );
    },
  );
});
