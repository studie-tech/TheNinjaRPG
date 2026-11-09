import { beforeEach, expect, it } from "bun:test";
import { aiProfile, battle, userData } from "@/drizzle/schema";
import { getNewTrackers } from "@/libs/quest";
import { handleQuestConsequences } from "@/server/utils/questConsequences";
import { InstantStartBattleObjective } from "@/validators/objectives";
import { insertDefaultAiProfile, insertUsers } from "../../../../setup/factories";
import { trackerQuest, trackerUser } from "../../../../setup/quest";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("quest battle rejection feedback", () => {
  beforeEach(async () => {
    await resetTables(battle, userData, aiProfile);
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        experience: 20000000,
      },
      { userId: "template", isAi: true },
    ]);
    await insertDefaultAiProfile({ userId: "template" });
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
        id: "fight",
        task: "start_battle",
        opponentAIs: [{ ids: ["template"], number: 1 }],
        allyAIs: [{ ids: [allyId], number }],
      });
      const quest = trackerQuest("quest", [objective], "mission", { name: "Allies" });
      const user = trackerUser(
        [quest],
        [{ id: quest.id, startAt: new Date().toISOString(), goals: [] }],
        { ...hero, items: [], useritems: [] },
      );
      const tracking = getNewTrackers(user, [{ task: "any", contentId: "fight" }]);
      user.questData = tracking.trackers;

      const result = await handleQuestConsequences(
        client,
        user,
        tracking.consequences,
        tracking.notifications,
      );

      expect(result).toEqual({
        notifications: ["Attacking 1 target for Allies.", message],
        claimed: true,
        battleAttempted: true,
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
