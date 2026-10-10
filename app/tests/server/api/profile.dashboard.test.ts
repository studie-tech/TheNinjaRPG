
import { beforeEach, expect, it } from "bun:test";
import {
  quest,
  questHistory,
  raidDamageThreshold,
  raidParticipation,
  userData,
} from "@/drizzle/schema";
import { profileRouter } from "@/routers/profile";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

describeWithDatabase("profile dashboard raid history", () => {
  beforeEach(async () => {
    await resetTables(raidDamageThreshold, raidParticipation, questHistory, quest, userData);
    await insertUsers([{ userId: "dashboard-user" }]);
  });

  it("ignores deleted raids while retaining existing rewards, progress and discovery", async () => {
    const database = await getTestDatabase();
    await insertQuests([
      { id: "existing-raid", name: "Existing raid", questType: "raid" },
      { id: "story", name: "Story", questType: "story" },
    ]);
    await database.insert(raidParticipation).values([
      { id: "orphan", userId: "dashboard-user", questId: "deleted-raid", damageDealt: 200 },
      { id: "existing", userId: "dashboard-user", questId: "existing-raid", damageDealt: 200 },
    ]);
    await database.insert(raidDamageThreshold).values({
      id: "threshold", questId: "existing-raid", damageRequired: 100, rewards: ObjectiveReward.parse({}),
    });

    const result = await (await callerFor(profileRouter, "dashboard-user")).getDashboard();
    expect(result.raidProgress).toEqual([{ raidId: "existing-raid", damageDealt: 200 }]);
    expect(result.raidRewards).toEqual([
      { raidId: "existing-raid", raidName: "Existing raid", claimableCount: 1 },
    ]);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["story"]);
    expect(await database.select().from(raidParticipation)).toHaveLength(2);
  });

  it("returns empty raid summaries when every participation belongs to a deleted raid", async () => {
    const database = await getTestDatabase();
    await database.insert(raidParticipation).values({
      id: "orphan", userId: "dashboard-user", questId: "deleted-raid", damageDealt: 200,
    });
    const result = await (await callerFor(profileRouter, "dashboard-user")).getDashboard();
    expect(result.raidProgress).toEqual([]);
    expect(result.raidRewards).toEqual([]);
  });
});
