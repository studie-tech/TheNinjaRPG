import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { item, quest, questHistory, userData, userItem } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { getNewTrackers } from "@/libs/quest";
import * as socials from "@/libs/socials";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { assignQuestToUser } from "@/server/utils/questAssignment";
import {
  DialogObjective,
  InstantStartBattleObjective,
  QuestTracker,
  SimpleObjective,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import { beforeStatements, failCommits } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const floor = InstantStartBattleObjective.parse({
  id: "floor",
  task: "start_battle",
  opponentAIs: [{ ids: ["foe"], number: 1 }],
});
const content = {
  objectives: [
    DialogObjective.parse({
      id: "enter",
      task: "dialog",
      nextObjectiveId: [{ text: "Enter", nextObjectiveId: "floor" }],
    }),
    floor,
  ],
  reward: ObjectiveReward.parse({}),
  sceneBackground: "",
  sceneCharacters: ["character"],
};
const checkpoint = QuestTracker.parse({
  id: "pyramid",
  startAt: "2026-01-01T00:00:00.000Z",
  goals: [
    { id: "enter", done: true, selectedNextObjectiveId: "floor", value: 7 },
    { id: "floor", value: 3 },
  ],
});

describeWithDatabase("quest run state preservation", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userItem, item, userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    await insertUsers([
      {
        userId: "hero",
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
      { userId: "editor", role: "OWNER" },
    ]);
    await insertQuests([
      {
        id: "pyramid",
        name: "Pyramid",
        questType: "battlepyramid",
        hidden: true,
        maxAttempts: 100,
        maxCompletes: 100,
        content,
      },
      {
        id: "mission",
        questType: "mission",
        questRank: "A",
        hidden: false,
        content: {
          ...content,
          objectives: [
            SimpleObjective.parse({ id: "train", task: "stats_trained", value: 100 }),
          ],
        },
      },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([0, 1])(
    "keeps unavailable guidance for hidden achievement history with completed=%s",
    async (completed) => {
      await insertQuests([
        { id: "hidden-achievement", questType: "achievement", hidden: true, content },
      ]);
      await insertQuestHistory([
        {
          userId: "hero",
          questId: "hidden-achievement",
          questType: "achievement",
          completed,
        },
      ]);
      const result = await (await callerFor(questsRouter, "hero")).checkRewards({
        questId: "hidden-achievement",
      });
      expect(result).toMatchObject({
        success: false,
        message: "This quest is currently unavailable.",
      });
    },
  );

  it.each(["story", "event", "mission", "battlepyramid"] as const)(
    "keeps hidden %s guidance appropriate after a regeneration snapshot loss",
    async (questType) => {
      const client = await getTestDatabase();
      const oldSnapshotAt = new Date(Date.now() - 350_000);
      await insertQuests([
        {
          id: "hidden-quest",
          questType,
          hidden: true,
          maxAttempts: 100,
          maxCompletes: 100,
          content,
        },
      ]);
      const authored = await client.query.quest.findFirst({
        where: eq(quest.id, "hidden-quest"),
      });
      await insertQuestHistory([
        {
          id: "hidden-attempt",
          userId: "hero",
          questId: "hidden-quest",
          questType,
          questVersion: authored!.updatedAt,
        },
      ]);
      await client
        .update(userData)
        .set({
          updatedAt: oldSnapshotAt,
          regenAt: new Date(Date.now() - 125_000),
          money: 1000,
          questData: [
            QuestTracker.parse({
              id: "hidden-quest",
              goals: [{ id: "floor", done: false, recentlyDied: true }],
            }),
          ],
        })
        .where(eq(userData.userId, "hero"));
      // A competing account claim makes regeneration reload history after availability filtering.
      let competingClaimed = false;
      const raced = beforeStatements(client, userData, [
        async () => {
          const claim = await claimUserSnapshot({
            client,
            userId: "hero",
            updatedAt: oldSnapshotAt,
          });
          expect(claim.success).toBe(true);
          competingClaimed = true;
        },
      ]);
      const result = await callerForDatabase(questsRouter, "hero", raced).checkRewards({
        questId: "hidden-quest",
      });
      expect(competingClaimed).toBe(true);
      expect(result).toMatchObject({
        success: false,
        message:
          questType === "battlepyramid"
            ? "This Pyramid is paused or changed. Return to the Battle Arena to resume or abandon it."
            : "This quest is currently unavailable.",
      });
      const [hero, history] = await Promise.all([
        client.query.userData.findFirst({ where: eq(userData.userId, "hero") }),
        client.query.questHistory.findFirst({
          where: eq(questHistory.id, "hidden-attempt"),
        }),
      ]);
      expect(hero?.money).toBe(1000);
      expect(history).toMatchObject({ completed: 0, endAt: null });
    },
  );

  it("persists a frozen hidden checkpoint through an unrelated assignment and resumes it on unhide", async () => {
    const client = await getTestDatabase();
    const authored = await client.query.quest.findFirst({
      where: eq(quest.id, "pyramid"),
    });
    await insertQuestHistory([
      {
        userId: "hero",
        questId: "pyramid",
        questType: "battlepyramid",
        entryPaid: true,
        questVersion: authored!.updatedAt,
      },
    ]);
    await client
      .update(userData)
      .set({ questData: [checkpoint] })
      .where(eq(userData.userId, "hero"));
    const caller = await callerFor(questsRouter, "hero");
    expect(
      (await caller.startQuest({ questId: "mission", userSector: 0 })).success,
    ).toBe(true);
    const stored = await client.query.userData.findFirst({
      where: eq(userData.userId, "hero"),
    });
    expect(stored?.questData?.find((tracker) => tracker.id === "pyramid")).toEqual(
      checkpoint,
    );
    const { user } = await fetchUpdatedUser({ client, userId: "hero" });
    if (!user) throw new Error("Missing player");
    const frozen = getNewTrackers(user, [
      { task: "any" },
      { task: "start_battle", contentId: "foe", text: "Won" },
    ]);
    expect(frozen.trackers.find((tracker) => tracker.id === "pyramid")).toEqual(
      checkpoint,
    );
    expect(frozen.notifications).toEqual([]);
    expect(frozen.consequences).toEqual([]);
    await client
      .update(quest)
      .set({ hidden: false, updatedAt: authored!.updatedAt })
      .where(eq(quest.id, "pyramid"));
    user.userQuests.find((entry) => entry.questId === "pyramid")!.quest.hidden = false;
    expect(
      getNewTrackers(user, []).trackers.find((tracker) => tracker.id === "pyramid"),
    ).toEqual(checkpoint);
    expect(
      (
        await client.query.questHistory.findFirst({
          where: eq(questHistory.questId, "pyramid"),
        })
      )?.entryPaid,
    ).toBe(true);
  });

  it.each(["ended", "completed", "edited", "missing"] as const)(
    "does not retain a hidden %s run",
    async (state) => {
      const client = await getTestDatabase();
      const authored = await client.query.quest.findFirst({
        where: eq(quest.id, "pyramid"),
      });
      await insertQuestHistory([
        {
          userId: "hero",
          questId: "pyramid",
          questType: "battlepyramid",
          questVersion: authored!.updatedAt,
          ...(state === "ended" ? { endAt: new Date() } : {}),
          ...(state === "completed" ? { completed: 1 } : {}),
        },
      ]);
      await client
        .update(userData)
        .set({ questData: state === "missing" ? [] : [checkpoint] })
        .where(eq(userData.userId, "hero"));
      if (state === "edited")
        await client
          .update(quest)
          .set({ updatedAt: new Date(authored!.updatedAt.getTime() + 1) })
          .where(eq(quest.id, "pyramid"));
      const { user } = await fetchUpdatedUser({ client, userId: "hero" });
      expect(getNewTrackers(user!, [{ task: "any" }]).trackers).toEqual([]);
    },
  );

  it("does not restore a checkpoint explicitly removed by abandonment", async () => {
    const client = await getTestDatabase();
    await insertQuestHistory([
      { userId: "hero", questId: "pyramid", questType: "battlepyramid" },
    ]);
    await client
      .update(userData)
      .set({ questData: [checkpoint] })
      .where(eq(userData.userId, "hero"));
    expect(
      (await (await callerFor(questsRouter, "hero")).abandon({ id: "pyramid" }))
        .success,
    ).toBe(true);
    expect(
      (await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
        ?.questData,
    ).toEqual([]);
  });

  it("only closes open incomplete history when staff changes a Pyramid type", async () => {
    const client = await getTestDatabase();
    const old = new Date("2026-01-03T00:00:00.000Z");
    await insertUsers(
      ["open", "finished", "abandoned", "legacy"].map((userId) => ({
        userId,
        username: userId,
      })),
    );
    await insertQuestHistory([
      { userId: "open", questId: "pyramid", questType: "battlepyramid" },
      {
        userId: "finished",
        questId: "pyramid",
        questType: "battlepyramid",
        completed: 1,
        endAt: old,
      },
      {
        userId: "abandoned",
        questId: "pyramid",
        questType: "battlepyramid",
        endAt: old,
      },
      {
        userId: "legacy",
        questId: "pyramid",
        questType: "battlepyramid",
        completed: 1,
      },
    ]);
    const authored = await client.query.quest.findFirst({
      where: eq(quest.id, "pyramid"),
    });
    expect(
      (
        await (
          await callerFor(questsRouter, "editor")
        ).update({ id: "pyramid", data: { ...authored!, questType: "story" } })
      ).success,
    ).toBe(true);
    const rows = await client.query.questHistory.findMany();
    expect(rows.find((row) => row.userId === "open")?.endAt).toBeInstanceOf(Date);
    expect(rows.find((row) => row.userId === "finished")?.endAt).toEqual(old);
    expect(rows.find((row) => row.userId === "abandoned")?.endAt).toEqual(old);
    expect(rows.find((row) => row.userId === "legacy")?.endAt).toBeNull();
  });

  it.each([0, 1, 2])(
    "keeps a ticketed mission counter aligned after %s rolled-back retries",
    async (retries) => {
      const client = await getTestDatabase();
      await client
        .update(userData)
        .set({ dailyMissions: 19 })
        .where(eq(userData.userId, "hero"));
      await client
        .update(quest)
        .set({ content: { ...content, entryItems: [{ ids: ["ticket"], number: 1 }] } })
        .where(eq(quest.id, "mission"));
      await insertItems([{ id: "ticket" }]);
      await insertUserItems([
        { id: "tickets", userId: "hero", itemId: "ticket", quantity: 2 },
      ]);
      const authored = await client.query.quest.findFirst({
        where: eq(quest.id, "mission"),
      });
      const { user } = await fetchUpdatedUser({ client, userId: "hero" });
      const retrying = failCommits(
        client,
        retries,
        "Deadlock found when trying to get lock (errno 1213)",
      );
      expect(
        (
          await assignQuestToUser({
            client: retrying.client,
            user: user!,
            quest: authored!,
            source: "ui",
            prevAttempt: undefined,
          })
        ).success,
      ).toBe(true);
      expect(retrying.attempts()).toBe(retries + 1);
      expect(user!.dailyMissions).toBe(20);
      expect(
        (await client.query.userData.findFirst({ where: eq(userData.userId, "hero") }))
          ?.dailyMissions,
      ).toBe(20);
      expect(
        await client.query.questHistory.findMany({
          where: eq(questHistory.questId, "mission"),
        }),
      ).toMatchObject([{ entryPaid: true }]);
      // Rolled-back attempts must not leave their ticket debit behind.
      expect(
        (await client.query.userItem.findFirst({ where: eq(userItem.id, "tickets") }))
          ?.quantity,
      ).toBe(1);
    },
  );
});
