import { beforeEach, expect, it } from "bun:test";
import { aiProfile, battle, userData } from "@/drizzle/schema";
import { getNewTrackers } from "@/libs/quest";
import { handleQuestConsequences } from "@/server/api/routers/quests";
import { InstantStartBattleObjective } from "@/validators/objectives";
import { insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("quest battle rejection feedback", () => {
  beforeEach(async () => {
    await resetTables(battle, userData, aiProfile);
    await insertUsers([
      { userId: "hero", status: "AWAKE", rank: "JONIN", level: 50, experience: 20000000 },
      { userId: "template", isAi: true },
    ]);
    const client = await getTestDatabase();
    await client.insert(aiProfile).values({ id: "Default", userId: "template", rules: [] });
  });

  for (const [allyId, number, message] of [
    ["template", 100, "Too many NPCs for this battlefield"],
    ["missing", 1, "One of the ally AIs is unavailable"],
  ] as const) {
    it(`reports ${message} without creating a battle`, async () => {
      const client = await getTestDatabase();
      const hero = await client.query.userData.findFirst({
        where: (u, { eq }) => eq(u.userId, "hero"),
      });
      const objective = InstantStartBattleObjective.parse({
        id: "fight", task: "start_battle",
        opponentAIs: [{ ids: ["template"], number: 1 }],
        allyAIs: [{ ids: [allyId], number }],
      });
      const user = {
        ...hero, items: [], useritems: [], activeWars: [], completedQuests: [],
        questData: [{ id: "quest", startAt: new Date().toISOString(), goals: [] }],
        userQuests: [{
          questId: "quest", completed: 0, previousAttempts: 0, previousCompletes: 0,
          quest: {
            id: "quest", name: "Allies", questType: "mission", hidden: false,
            maxAttempts: 100, maxCompletes: 100, content: { objectives: [objective] },
          },
        }],
      } as unknown as Parameters<typeof getNewTrackers>[0];
      const tracking = getNewTrackers(user, [{ task: "any", contentId: "fight" }]);
      user.questData = tracking.trackers;

      const result = await handleQuestConsequences(
        client, user, tracking.consequences, tracking.notifications,
      );

      expect(result).toEqual({
        notifications: ["Attacking 1 target for Allies.", message], claimed: true,
      });
      expect(await client.query.battle.findMany()).toHaveLength(0);
      const saved = await client.query.userData.findFirst({
        where: (u, { eq }) => eq(u.userId, "hero"),
      });
      expect(saved?.status).toBe("AWAKE");
      expect(saved?.battleId).toBeNull();
      expect(saved?.questData).toEqual(user.questData);
    });
  }
});
