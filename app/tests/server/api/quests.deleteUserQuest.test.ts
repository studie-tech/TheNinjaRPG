// @vitest-environment node

import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { actionLog, quest, questHistory, userData } from "@/drizzle/schema";
import { questsRouter } from "@/server/api/routers/quests";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const caller = (userId: string) => callerFor(questsRouter, userId);

const startedAt = new Date("2026-09-10T12:00:00.000Z");
const questFinishAt = new Date("2026-09-10T13:00:00.000Z");

const deletionRequest = (
  requestId: string,
  overrides: Partial<{
    userId: string;
    expectedUsername: string;
    userQuestId: string;
    questId: string;
    expectedQuestName: string;
    expectedQuestType: "mission" | "daily";
    expectedStartedAt: Date;
    expectedEndAt: Date | null;
    expectedCompleted: number;
  }> = {},
) => ({
  userId: "quest-delete-target",
  expectedUsername: "Quest Delete Target",
  userQuestId: "history-delete",
  questId: "quest-delete",
  expectedQuestName: "Gap 87 Active Mission",
  expectedQuestType: "mission" as const,
  expectedStartedAt: startedAt,
  expectedEndAt: null,
  expectedCompleted: 0,
  requestId,
  ...overrides,
});

describeWithDatabase("quests.deleteUserQuest", () => {
  beforeEach(async () => {
    await resetTables(actionLog, questHistory, quest, userData);
    await insertUsers([
      {
        userId: "quest-delete-owner",
        username: "Quest Delete Owner",
        role: "OWNER",
      },
      {
        userId: "quest-delete-target",
        username: "Quest Delete Target",
        questData: [
          { id: "quest-delete", startAt: startedAt.toISOString(), goals: [] },
          { id: "quest-sibling", startAt: startedAt.toISOString(), goals: [] },
        ],
        activeNpcQuestId: "quest-delete",
        questFinishAt,
        dailyMissions: 9,
      },
      {
        userId: "quest-delete-other",
        username: "Quest Delete Other",
      },
      {
        userId: "quest-delete-banned",
        username: "Quest Delete Banned",
        role: "OWNER",
        isBanned: true,
      },
      {
        userId: "quest-delete-content",
        username: "Quest Delete Content",
        role: "CONTENT",
      },
      {
        userId: "quest-delete-user",
        username: "Quest Delete User",
        role: "USER",
      },
    ]);
    await insertQuests([
      {
        id: "quest-delete",
        name: "Gap 87 Active Mission",
        questType: "mission",
      },
      {
        id: "quest-sibling",
        name: "Gap 87 Sibling Daily",
        questType: "daily",
      },
    ]);
    await insertQuestHistory([
      {
        id: "history-delete",
        userId: "quest-delete-target",
        questId: "quest-delete",
        questType: "mission",
        startedAt,
        completed: 0,
        previousAttempts: 4,
        previousCompletes: 3,
        periodCompletes: 2,
      },
      {
        id: "history-sibling",
        userId: "quest-delete-target",
        questId: "quest-sibling",
        questType: "daily",
        startedAt,
        endAt: questFinishAt,
        completed: 1,
        previousAttempts: 5,
        previousCompletes: 4,
      },
    ]);
  });

  it("atomically deletes the exact aggregate record, tracker and NPC slot and replays once", async () => {
    const database = await getTestDatabase();
    const api = await caller("quest-delete-owner");
    const input = deletionRequest("87000000-0000-4000-8000-000000000001");

    const first = await api.deleteUserQuest(input);
    const replay = await api.deleteUserQuest(input);
    const histories = await database
      .select()
      .from(questHistory)
      .where(eq(questHistory.userId, input.userId));
    const target = await database.query.userData.findFirst({
      where: eq(userData.userId, input.userId),
    });
    const receipts = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.id, `delete-user-quest:${input.requestId}`));

    expect(first).toMatchObject({
      success: true,
      requestId: input.requestId,
      deletion: {
        userId: input.userId,
        userQuestId: input.userQuestId,
        questId: input.questId,
        questName: input.expectedQuestName,
        completed: 0,
      },
    });
    expect(replay).toMatchObject({
      success: true,
      requestId: input.requestId,
      deletion: first.deletion,
    });
    expect(histories).toHaveLength(1);
    expect(histories[0]?.id).toBe("history-sibling");
    expect(target?.questData).toEqual([
      { id: "quest-sibling", startAt: startedAt.toISOString(), goals: [] },
    ]);
    expect(target).toMatchObject({
      activeNpcQuestId: null,
      dailyMissions: 9,
      questFinishAt,
    });
    expect(receipts).toHaveLength(1);
  });

  it("rejects stale state and wrong-target history without deleting either sibling", async () => {
    const database = await getTestDatabase();
    const api = await caller("quest-delete-owner");

    const stale = await api.deleteUserQuest(
      deletionRequest("87000000-0000-4000-8000-000000000002", {
        expectedCompleted: 1,
      }),
    );
    const wrongTarget = await api.deleteUserQuest(
      deletionRequest("87000000-0000-4000-8000-000000000003", {
        userId: "quest-delete-other",
        expectedUsername: "Quest Delete Other",
      }),
    );
    const histories = await database
      .select()
      .from(questHistory)
      .where(inArray(questHistory.id, ["history-delete", "history-sibling"]));

    expect(stale.success).toBe(false);
    expect(wrongTarget.success).toBe(false);
    expect(histories).toHaveLength(2);
  });

  it("serializes distinct concurrent requests so only one can claim the record", async () => {
    const database = await getTestDatabase();
    const api = await caller("quest-delete-owner");
    const [first, second] = await Promise.all([
      api.deleteUserQuest(
        deletionRequest("87000000-0000-4000-8000-000000000004"),
      ),
      api.deleteUserQuest(
        deletionRequest("87000000-0000-4000-8000-000000000005"),
      ),
    ]);
    const remaining = await database.query.questHistory.findFirst({
      where: eq(questHistory.id, "history-delete"),
    });
    const receipts = await database
      .select()
      .from(actionLog)
      .where(eq(actionLog.relatedId, "quest-delete-target"));

    expect([first.success, second.success].filter(Boolean)).toHaveLength(1);
    expect(remaining).toBeUndefined();
    expect(receipts).toHaveLength(1);
  });

  it("enforces bans, permissions, self-only roles and target identity", async () => {
    const database = await getTestDatabase();
    const owner = await caller("quest-delete-owner");
    const banned = await caller("quest-delete-banned");
    const content = await caller("quest-delete-content");
    const regular = await caller("quest-delete-user");

    const staleIdentity = await owner.deleteUserQuest(
      deletionRequest("87000000-0000-4000-8000-000000000006", {
        expectedUsername: "Previous Name",
      }),
    );
    const bannedResult = await banned.deleteUserQuest(
      deletionRequest("87000000-0000-4000-8000-000000000007"),
    );
    const selfOnly = await content.deleteUserQuest(
      deletionRequest("87000000-0000-4000-8000-000000000008"),
    );
    const unauthorized = await regular.deleteUserQuest(
      deletionRequest("87000000-0000-4000-8000-000000000009"),
    );
    const history = await database.query.questHistory.findFirst({
      where: eq(questHistory.id, "history-delete"),
    });

    expect(staleIdentity.success).toBe(false);
    expect(bannedResult.success).toBe(false);
    expect(selfOnly.success).toBe(false);
    expect(unauthorized.success).toBe(false);
    expect(history).toBeDefined();
  });
});
