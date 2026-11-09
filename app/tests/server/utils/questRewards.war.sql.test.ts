import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { userData, village, villageStructure, war } from "@/drizzle/schema";
import { updateRewards } from "@/server/utils/questRewards";
import { PostProcessedRewardSchema } from "@/validators/rewards";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const warRow = (patch: Partial<typeof war.$inferInsert> = {}) => ({
  id: "war",
  type: "VILLAGE_WAR" as const,
  status: "ACTIVE" as const,
  sector: 201,
  attackerVillageId: "attacker",
  defenderVillageId: "defender",
  attackerWarHealth: 100,
  defenderWarHealth: 100,
  attackerWarHealthMax: 120,
  defenderWarHealthMax: 120,
  defenderShrineHp: 0,
  ...patch,
});

/** War rewards hit the enemy's health and heal the player's own side. */
describeWithDatabase("updateRewards war health", () => {
  beforeEach(async () => {
    await resetTables(war, villageStructure, village, userData);
    await insertUsers([
      { userId: "attacking", villageId: "attacker" },
      { userId: "defending", villageId: "defender" },
    ]);
    const client = await getTestDatabase();
    await client.insert(village).values(
      ["attacker", "defender"].map((id, i) => ({
        id,
        name: id,
        sector: 201 + i,
        kageId: `${id}-kage`,
        tokens: 1000,
      })),
    );
    await client.insert(villageStructure).values(
      ["attacker", "defender"].map((id) => ({
        id: `${id}/townhall`,
        name: "Town Hall",
        route: "/townhall",
        image: "",
        villageId: id,
        curSp: 1000,
      })),
    );
  });

  const payOut = async (
    userId: string,
    rewards: { reward_war_damage?: number; reward_war_healing?: number },
    inTransaction = false,
  ) => {
    const client = await getTestDatabase();
    const user = await client.query.userData.findFirst({
      where: eq(userData.userId, userId),
    });
    await updateRewards({
      client,
      user: user!,
      inTransaction,
      rewards: PostProcessedRewardSchema.parse(rewards),
      reason: "QUEST",
    });
    return client.query.war.findFirst({ where: eq(war.id, "war") });
  };

  it.each([
    ["attacking", { reward_war_damage: 10 }, 100, 90],
    ["defending", { reward_war_damage: 10 }, 90, 100],
    ["attacking", { reward_war_healing: 5 }, 105, 100],
    ["defending", { reward_war_healing: 5 }, 100, 105],
    ["attacking", { reward_war_damage: 10, reward_war_healing: 5 }, 105, 90],
    ["defending", { reward_war_damage: 10, reward_war_healing: 5 }, 90, 105],
    ["attacking", { reward_war_damage: 500 }, 100, 0],
    ["defending", { reward_war_healing: 500 }, 100, 120],
  ])("%s with %j", async (userId, rewards, attackerWarHealth, defenderWarHealth) => {
    await (await getTestDatabase()).insert(war).values(warRow());
    expect(await payOut(userId, rewards)).toMatchObject({
      attackerWarHealth,
      defenderWarHealth,
    });
  });

  it("leaves a finished war untouched", async () => {
    await (await getTestDatabase()).insert(war).values(warRow({ endedAt: new Date() }));
    expect(
      await payOut("attacking", { reward_war_damage: 10, reward_war_healing: 5 }),
    ).toMatchObject({ attackerWarHealth: 100, defenderWarHealth: 100 });
  });

  it("closes a raid before healing once the damage defeats the enemy", async () => {
    await (await getTestDatabase())
      .insert(war)
      .values(warRow({ type: "WAR_RAID", defenderWarHealth: 10 }));
    expect(
      await payOut("attacking", { reward_war_damage: 10, reward_war_healing: 5 }, true),
    ).toMatchObject({ attackerWarHealth: 100, defenderWarHealth: 0 });
  });
});
