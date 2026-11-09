import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { quest, questHistory, userData } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { staffRouter } from "@/server/api/routers/staff";
import { createTRPCRouter } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { handleQuestConsequences } from "@/server/utils/questConsequences";
import {
  DialogObjective,
  InstantNewQuestObjective,
  QuestTracker,
  SimpleObjective,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import { overrideQuery } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const router = createTRPCRouter({ quests: questsRouter });
const hold = DialogObjective.parse({
  id: "hold",
  task: "dialog",
  nextObjectiveId: [{ text: "Continue", nextObjectiveId: "later" }],
});
const entry = DialogObjective.parse({
  id: "entry",
  task: "dialog",
  nextObjectiveId: [{ text: "Continue", nextObjectiveId: "grant" }],
});
const later = SimpleObjective.parse({ id: "later", task: "stats_trained", value: 100 });
const base = {
  isolated: true,
  entryItems: [],
  objectives: [hold, later],
  reward: ObjectiveReward.parse({}),
  sceneBackground: "",
  sceneCharacters: [],
};
const activeRows = (db: DrizzleClient) =>
  db.query.questHistory.findMany({
    where: and(
      eq(questHistory.userId, "hero"),
      eq(questHistory.questType, "battlepyramid"),
      eq(questHistory.completed, 0),
      isNull(questHistory.endAt),
    ),
  });
const state = (db: DrizzleClient) =>
  db.query.userData.findFirst({ where: eq(userData.userId, "hero") });

describeWithDatabase("Pyramid consequence publication", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertUsers([
      {
        userId: "hero",
        status: "BATTLE",
        battleId: null,
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    await insertQuests([
      {
        id: "p1",
        name: "P1",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        questType: "battlepyramid",
        consecutiveObjectives: true,
        content: base,
      },
      {
        id: "p2",
        name: "P2",
        hidden: false,
        maxAttempts: 100,
        maxCompletes: 100,
        questType: "battlepyramid",
        consecutiveObjectives: true,
        content: base,
      },
    ]);
    const p1 = await (await getTestDatabase()).query.quest.findFirst({
      where: eq(quest.id, "p1"),
    });
    await insertQuestHistory([
      {
        id: "p1-attempt",
        userId: "hero",
        questId: "p1",
        questType: "battlepyramid",
        isolated: true,
        questVersion: p1!.updatedAt,
      },
    ]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTables(questHistory);
  });

  it.each([false, true])(
    "starts a replacement only after terminal completion=%s",
    async (terminal) => {
      const db = await getTestDatabase();
      const grant = InstantNewQuestObjective.parse({
        id: "grant",
        task: "new_quest",
        newQuestIds: ["p2"],
        ...(terminal ? {} : { nextObjectiveId: "hold" }),
      });
      await db
        .update(quest)
        .set({
          content: {
            ...base,
            objectives: terminal ? [entry, grant] : [entry, grant, hold, later],
          },
        })
        .where(eq(quest.id, "p1"));
      const p1 = await db.query.quest.findFirst({ where: eq(quest.id, "p1") });
      await db
        .update(questHistory)
        .set({ questVersion: p1!.updatedAt })
        .where(eq(questHistory.id, "p1-attempt"));
      await db
        .update(userData)
        .set({
          questData: [
            QuestTracker.parse({
              id: "p1",
              startAt: new Date().toISOString(),
              goals: [{ id: "entry", value: 0 }],
            }),
          ],
        })
        .where(eq(userData.userId, "hero"));
      const result = await (await callerFor(router, "hero")).quests.checkRewards({
        questId: "p1",
        nextObjectiveId: "grant",
      });
      expect(result.success).toBe(true);
      expect((result.notifications ?? []).includes("Started new quest: P2")).toBe(
        terminal,
      );
      expect((await activeRows(db)).map((row) => row.questId).sort()).toEqual(
        terminal ? ["p2"] : ["p1"],
      );
      expect((await state(db))?.status).toBe("BATTLE");
    },
  );
  it("an intentional fail P1 and start P2 consequence leaves only P2", async () => {
    const db = await getTestDatabase();
    const { user } = await fetchUpdatedUser({ client: db, userId: "hero" });
    const result = await handleQuestConsequences(
      db,
      user!,
      [
        { type: "fail_quest", ids: ["p1"] },
        { type: "start_quest", ids: ["p2"] },
      ],
      [],
    );
    expect(result.claimed).toBe(true);
    expect((await activeRows(db)).map((row) => row.questId)).toEqual(["p2"]);
  });
  it("rejects a story start when UI assignment wins after the objective snapshot claim", async () => {
    const db = await getTestDatabase();
    await resetTables(questHistory);
    await db
      .update(userData)
      .set({ status: "AWAKE" })
      .where(eq(userData.userId, "hero"));
    const { user } = await fetchUpdatedUser({ client: db, userId: "hero" });
    let injected = false;
    const client = overrideQuery(db, "quest", {
      findMany: async (read, ...args) => {
        if (!injected) {
          injected = true;
          expect(
            (
              await (
                await callerFor(router, "hero")
              ).quests.startQuest({ questId: "p2", userSector: 0 })
            ).success,
          ).toBe(true);
        }
        return read(...args);
      },
    });
    const result = await handleQuestConsequences(
      client,
      user!,
      [{ type: "start_quest", ids: ["p1"] }],
      [],
    );
    expect(result.claimed).toBe(true);
    expect(result.notifications).toEqual([
      expect.stringContaining("Could not start P1"),
    ]);
    expect((await activeRows(db)).map((row) => row.questId).sort()).toEqual(["p2"]);
  });
  it("publishes only one Pyramid from multiple destinations", async () => {
    const db = await getTestDatabase();
    await resetTables(questHistory);
    await db
      .update(userData)
      .set({ status: "AWAKE" })
      .where(eq(userData.userId, "hero"));
    const { user } = await fetchUpdatedUser({ client: db, userId: "hero" });
    const result = await handleQuestConsequences(
      db,
      user!,
      [{ type: "start_quest", ids: ["p1", "p2"] }],
      [],
    );
    expect(result.claimed).toBe(true);
    const active = await activeRows(db);
    expect(active).toHaveLength(1);
    const name = active[0]!.questId === "p1" ? "P1" : "P2";
    expect(
      result.notifications.filter((message) =>
        message.startsWith("Started new quest:"),
      ),
    ).toEqual([`Started new quest: ${name}`]);
    expect(
      result.notifications.filter((message) => message.startsWith("Could not start")),
    ).toHaveLength(1);
  });

  it.each(["p1", "p2"])(
    "staff recovery prevents an in-flight objective from restarting %s",
    async (destination) => {
      const db = await getTestDatabase();
      await insertUsers([
        { userId: "staff", username: "recovery-staff", role: "OWNER" },
      ]);
      const grant = InstantNewQuestObjective.parse({
        id: "grant",
        task: "new_quest",
        newQuestIds: [destination],
        nextObjectiveId: "hold",
      });
      await db
        .update(quest)
        .set({ content: { ...base, objectives: [entry, grant, hold, later] } })
        .where(eq(quest.id, "p1"));
      const p1 = await db.query.quest.findFirst({ where: eq(quest.id, "p1") });
      await db
        .update(questHistory)
        .set({ questVersion: p1!.updatedAt })
        .where(eq(questHistory.id, "p1-attempt"));
      await db
        .update(userData)
        .set({
          questData: [
            QuestTracker.parse({
              id: "p1",
              startAt: new Date().toISOString(),
              goals: [{ id: "entry", value: 0 }],
            }),
          ],
        })
        .where(eq(userData.userId, "hero"));
      let rescued = false;
      const client = overrideQuery(db, "quest", {
        findMany: async (read, ...args) => {
          const rows = await read(...args);
          if (!rescued && rows.some((row) => row.id === destination)) {
            rescued = true;
            expect(
              (
                await (
                  await callerFor(staffRouter, "staff")
                ).forceAwake({ userId: "hero", reason: "Cancel a stranded Pyramid" })
              ).success,
            ).toBe(true);
            expect(await activeRows(db)).toHaveLength(0);
            expect((await state(db))?.status).toBe("AWAKE");
          }
          return rows;
        },
      });
      const result = await callerForDatabase(
        router,
        "hero",
        client,
      ).quests.checkRewards({ questId: "p1", nextObjectiveId: "grant" });
      expect(rescued).toBe(true);
      expect(await activeRows(db)).toHaveLength(0);
      expect((await state(db))?.status).toBe("AWAKE");
      expect(result.success).toBe(true);
      expect(result.notifications).toEqual([
        expect.stringContaining(
          `Could not start ${destination === "p1" ? "P1" : "P2"}`,
        ),
      ]);
    },
  );
});
