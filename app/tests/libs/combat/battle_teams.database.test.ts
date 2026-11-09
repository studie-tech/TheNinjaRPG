import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { war, warKill } from "@/drizzle/schema";
import { updateWars } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

describeWithDatabase("battle team war credit", () => {
  beforeEach(async () => resetTables(war, warKill));

  it("persists shared faction credit without treating a politically opposing teammate as a victim", async () => {
    const db = await getTestDatabase();
    await db.insert(war).values({
      id: "team-war",
      attackerVillageId: "a",
      defenderVillageId: "b",
      type: "VILLAGE_WAR",
      status: "ACTIVE",
      attackerWarHealth: 10,
      attackerWarHealthMax: 100,
    });
    const saved = (await db.query.war.findFirst({ where: eq(war.id, "team-war") }))!;
    const hero = makeBattleUser("hero", {
      direction: "left",
      isAggressor: true,
      villageId: "a",
      sector: 10,
    });
    const ally = makeBattleUser("ally", {
      direction: "left",
      villageId: "c",
      sector: 10,
    });
    const politicalEnemyAlly = makeBattleUser("ally-b", {
      direction: "left",
      villageId: "b",
      sector: 10,
    });
    const foe = makeBattleUser("foe", {
      direction: "right",
      villageId: "b",
      curHealth: 0,
      sector: 10,
    });
    const battle = makeCompleteBattle({
      battleType: "COMBAT",
      rewardScaling: 1,
      usersState: [politicalEnemyAlly, ally, foe, hero],
      extraState: {
        wars: {
          "team-war": {
            ...saved,
            warAllies: [],
            attackerVillage: { name: "A" },
            defenderVillage: { name: "B" },
          },
        },
      },
    });
    const result = calcBattleResult(battle, ally.userId)!;
    expect(result.warHealthChange).toBeGreaterThan(0);
    await updateWars(db, {} as never, battle, result, ally.userId);
    const kills = await db.query.warKill.findMany();
    expect(
      kills.map((kill) => ({ killer: kill.killerId, victim: kill.victimId })),
    ).toEqual([{ killer: "ally", victim: "foe" }]);
    const updated = await db.query.war.findFirst({ where: eq(war.id, "team-war") });
    expect(updated?.attackerWarHealth).toBe(10 + result.warHealthChange);
    expect(updated?.defenderWarHealth).toBe(saved.defenderWarHealth);
  });
});
