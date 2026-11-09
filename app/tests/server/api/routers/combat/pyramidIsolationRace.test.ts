import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { combatRouter } from "@/routers/combat";
import { questsRouter } from "@/routers/quests";
import { createTRPCRouter } from "@/server/api/trpc";
import { DialogObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const router = createTRPCRouter({ combat: combatRouter, quests: questsRouter });
describeWithDatabase("Battle Arena healing and isolated Pyramid entry", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userData);
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        regeneration: 0,
        curHealth: 100,
        maxHealth: 1000,
        curChakra: 100,
        maxChakra: 1000,
        curStamina: 100,
        maxStamina: 1000,
        money: 10000,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    await insertQuests([
      {
        id: "pyramid",
        name: "Pyramid",
        questType: "battlepyramid",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        content: {
          isolated: true,
          entryItems: [],
          objectives: [
            DialogObjective.parse({ id: "enter", task: "dialog", nextObjectiveId: [] }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
  });
  it("blocks outside healing while an isolated run is between floors", async () => {
    const client = await getTestDatabase();
    const caller = callerForDatabase(router, "hero", client);
    expect(
      (await caller.quests.startQuest({ questId: "pyramid", userSector: 0 })).success,
    ).toBe(true);
    const result = await caller.combat.battleArenaHeal();
    expect(result.success).toBe(false);
    expect(result.message).toContain("isolated Battle Pyramid");
    expect(
      (await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.curHealth,
    ).toBe(100);
  });
  it("rejects an outside heal if the user enters isolation after its middleware read", async () => {
    const client = await getTestDatabase();
    const starter = callerForDatabase(router, "hero", client);
    const interleaved = beforeStatements(client, userData, [
      async () => {
        expect(
          (await starter.quests.startQuest({ questId: "pyramid", userSector: 0 }))
            .success,
        ).toBe(true);
      },
    ]);
    const result = await callerForDatabase(
      router,
      "hero",
      interleaved,
    ).combat.battleArenaHeal();
    const [hero, attempt] = await Promise.all([
      client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
      client.query.questHistory.findFirst({
        where: eq(questHistory.questId, "pyramid"),
      }),
    ]);
    expect(hero).toMatchObject({
      status: "BATTLE",
      battleId: null,
      curHealth: 100,
      curChakra: 100,
      curStamina: 100,
      money: 10000,
    });
    expect(attempt).toMatchObject({ isolated: true, completed: 0, endAt: null });
    expect(result.success).toBe(false);
  });
});
