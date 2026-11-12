import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { badge, quest, questHistory, userBadge, userData } from "@/drizzle/schema";
import { insertQuestHistory, insertQuests, insertUsers } from "../setup/factories";
import { readMigration } from "../setup/migrations";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  runRawSql,
} from "../setup/testDatabase";

const originalId = "g2ilVOzFys21wkEHwfTeE";
const trialId = "creator-trial-achievement";
const badgeId = "creator-trial-badge";

describeWithDatabase("creator trial achievement migration", () => {
  beforeEach(async () => resetTables(badge, quest, questHistory, userBadge, userData));

  it("separates the badge without resetting original rewards, progress or staff edits", async () => {
    const database = await getTestDatabase();
    await insertUsers([{ userId: "hero" }]);
    const [original] = await insertQuests([
      {
        id: originalId,
        questType: "achievement",
        content: {
          reward: { reward_money: 12 },
          objectives: [
            {
              id: "goal",
              task: "defeat_opponents",
              reward_badges: ["before", badgeId, "after"],
            },
          ],
        },
      },
    ] as never);
    await insertQuestHistory([
      {
        id: "earned",
        questId: originalId,
        userId: "hero",
        questType: "achievement",
        completed: 1,
        previousCompletes: 1,
        endAt: new Date("2026-01-01"),
      },
    ]);
    const before = (await database.query.quest.findFirst({
      where: eq(quest.id, originalId),
    }))!;
    const history = await database.query.questHistory.findMany();
    const migration = await readMigration("0152_creator_trial_achievement.sql");
    await runRawSql(migration);
    const after = await database.query.quest.findFirst({
      where: eq(quest.id, originalId),
    });
    expect(after as unknown).toEqual({
      ...before,
      content: {
        ...original!.content,
        objectives: [
          { id: "goal", task: "defeat_opponents", reward_badges: ["before", "after"] },
        ],
      },
    });
    expect(await database.query.questHistory.findMany()).toEqual(history);
    expect(
      await database.query.quest.findFirst({ where: eq(quest.id, trialId) }),
    ).toMatchObject({
      questType: "achievement",
      content: {
        objectives: [
          {
            task: "defeat_opponents",
            opponentAIs: [{ ids: ["creator-trial-elite"], number: 1 }],
            completionOutcome: "Win",
            reward_badges: [badgeId],
          },
        ],
      },
    });
    await database
      .update(quest)
      .set({ description: "Edited by staff" })
      .where(eq(quest.id, trialId));
    await database
      .update(badge)
      .set({ description: "Edited badge" })
      .where(eq(badge.id, badgeId));
    const quests = await database.query.quest.findMany();
    const badges = await database.query.badge.findMany();
    await runRawSql(migration);
    expect(await database.query.quest.findMany()).toEqual(quests);
    expect(await database.query.badge.findMany()).toEqual(badges);
    expect(await database.query.questHistory.findMany()).toEqual(history);
    expect(await database.query.userBadge.findMany()).toEqual([]);
  });

  it("seeds a fresh installation independently of the original achievement", async () => {
    await runRawSql(await readMigration("0152_creator_trial_achievement.sql"));
    const database = await getTestDatabase();
    expect((await database.query.quest.findMany()).map((row) => row.id)).toEqual([
      trialId,
    ]);
    expect((await database.query.badge.findMany()).map((row) => row.id)).toEqual([
      badgeId,
    ]);
  });
});
