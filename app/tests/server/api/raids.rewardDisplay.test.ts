// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  badge,
  bloodline,
  bloodlineRolls,
  item,
  jutsu,
  quest,
  raidDamageThreshold,
  raidParticipation,
  userBadge,
  userData,
  userItem,
  userJutsu,
  userVote,
} from "@/drizzle/schema";
import { raidsRouter } from "@/server/api/routers/raids";
import { ObjectiveReward } from "@/validators/rewards";
import { insertItems, insertQuests, insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("raid reward display from confirmed grants", () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/pipeline")
          ? [{ result: [59, 60] }]
          : { result: [59, 60] },
      ),
    );
    await resetTables(
      userItem,
      userJutsu,
      userBadge,
      bloodlineRolls,
      raidParticipation,
      raidDamageThreshold,
      userVote,
      userData,
      quest,
      item,
      jutsu,
      badge,
      bloodline,
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
    await database
      .insert(jutsu)
      .values({
        id: "reward-jutsu",
        name: "Reward Jutsu",
        description: "Test",
        image: "/test.png",
        effects: [],
        target: "CHARACTER",
        range: 1,
        requiredRank: "STUDENT",
        jutsuType: "NORMAL",
        battleDescription: "Test",
      });
    await database
      .insert(bloodline)
      .values({
        id: "reward-bloodline",
        name: "Reward Bloodline",
        description: "Test",
        image: "/test.png",
        effects: [],
        rank: "D",
      });
    await database
      .insert(badge)
      .values({
        id: "reward-badge",
        name: "Reward Badge",
        description: "Test",
        image: "/test.png",
      });
    await database
      .insert(userVote)
      .values({
        id: "raid-reward-vote",
        userId: "raid-reward-user",
        secret: "raid0001",
        lastVoteAt: new Date(),
      });
    await database
      .insert(raidParticipation)
      .values({
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
    "reuses granted names, preserves item order and quantity, and skips owned content (owned=%s)",
    async (owned) => {
      const database = await getTestDatabase();
      if (owned) {
        await database
          .insert(userJutsu)
          .values({
            id: "owned-jutsu",
            userId: "raid-reward-user",
            jutsuId: "reward-jutsu",
          });
        await database
          .insert(bloodlineRolls)
          .values({
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
        database.query.bloodline,
        database.query.badge,
      ].map((table) =>
        vi
          .spyOn(table, "findMany")
          .mockRejectedValue(new Error("Content names were already loaded by payout")),
      );
      const api = await callerFor(raidsRouter, "raid-reward-user");
      const result = await api.claimDamageReward({
        questId: "reward-raid",
        thresholdId: "reward-threshold",
      });
      expect(result).toMatchObject({
        success: true,
        rewards: {
          reward_items: ["Potion B", "Potion A", "Potion A"],
          reward_jutsus: owned ? [] : ["Reward Jutsu"],
          reward_bloodlines: owned ? [] : ["Reward Bloodline"],
          reward_badges: owned ? [] : ["Reward Badge"],
        },
      });
      for (const reread of rereads) expect(reread).not.toHaveBeenCalled();
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
    },
  );
});
