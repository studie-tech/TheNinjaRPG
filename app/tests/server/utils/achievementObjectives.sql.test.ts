import { beforeEach, expect, it } from "bun:test";
import {
  dungeon,
  dungeonMember,
  dungeonRun,
  quest,
  raidParticipation,
  userData,
} from "@/drizzle/schema";
import { activityCompletionExtras } from "@/server/utils/achievementObjectives";
import { dungeonContent } from "../../setup/dungeon";
import { insertQuests, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("achievement completion receipts", () => {
  beforeEach(async () =>
    resetTables(dungeon, dungeonMember, dungeonRun, quest, raidParticipation, userData),
  );

  it("counts each successful dungeon and defeated raid once for its contributors", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "hero" }, { userId: "other" }]);
    const content = dungeonContent();
    await db.insert(dungeon).values({ id: "dungeon", content, updatedAt: new Date() });
    for (const [id, status] of [
      ["clear", "COMPLETED"],
      ["failed", "ENDED"],
      ["running", "BETWEEN"],
    ] as const) {
      await db.insert(dungeonRun).values({
        id,
        dungeonId: "dungeon",
        leaderId: "hero",
        content,
        state: {
          memberIds: ["hero"],
          readyIds: [],
          floor: 0,
          clearedFloors: [],
          invitedIds: [],
          message: "",
        },
        status,
        createdAt: new Date(),
      });
      await db.insert(dungeonMember).values({ runId: id, userId: "hero" });
    }
    await insertQuests([
      { id: "defeated", questType: "raid", raidBossCurrentHealth: 0 },
      { id: "alive", questType: "raid", raidBossCurrentHealth: 100 },
      { id: "no-damage", questType: "raid", raidBossCurrentHealth: 0 },
    ]);
    await db.insert(raidParticipation).values([
      {
        id: "a",
        userId: "hero",
        questId: "defeated",
        damageDealt: 30,
        battleCount: 3,
        rewardsClaimed: ["threshold"],
      },
      { id: "b", userId: "other", questId: "defeated", damageDealt: 10 },
      { id: "c", userId: "hero", questId: "alive", damageDealt: 50 },
      { id: "d", userId: "hero", questId: "no-damage", damageDealt: 0 },
    ]);
    for (let read = 0; read < 2; read++) {
      const users = await db.query.userData.findMany({
        extras: (table) => activityCompletionExtras(table.userId),
      });
      const hero = users.find((user) => user.userId === "hero");
      const other = users.find((user) => user.userId === "other");
      expect(Number(hero?.dungeonsCompleted)).toBe(1);
      expect(Number(hero?.raidsCompleted)).toBe(1);
      expect(Number(other?.dungeonsCompleted)).toBe(0);
      expect(Number(other?.raidsCompleted)).toBe(1);
    }
  });
});
