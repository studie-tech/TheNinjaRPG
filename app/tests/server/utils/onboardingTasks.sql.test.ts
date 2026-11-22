import { beforeEach, expect, it } from "bun:test";
import { BLACKSTEEL_CHAPTERS, ONBOARDING_DAILY_QUEST_IDS } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { quest, questHistory, userData, userVote } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { recordOnboardingTask } from "@/server/utils/onboardingTasks";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
  insertUserVotes,
} from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";
import { requireUser } from "../../setup/userReads";

const USER_ID = "onboarder";

const objective = (task: string, value: number) => ({
  id: task,
  task,
  value,
  description: "",
  successDescription: "",
});

/** A tracker of a quest the quest read does not load, which a write must keep. */
const unloadedTracker = {
  id: "finished-quest",
  goals: [{ id: "goal", done: false, value: 3 }],
};

const seed = async () => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Onboarder",
      status: "AWAKE",
      rank: "GENIN",
      level: 5,
      questData: [unloadedTracker],
    } as never,
  ]);
  await insertUserVotes([{ userId: USER_ID }]);
  await insertQuests([
    {
      id: "deposit-quest",
      content: { objectives: [objective("bank_deposit", 2)] as never },
    },
  ]);
  await insertQuestHistory([{ userId: USER_ID, questId: "deposit-quest" }]);
};

describeWithDatabase("recordOnboardingTask", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, userVote, userData);
  });

  it("counts the task on the open objective and keeps trackers it did not load", async () => {
    await seed();
    const client = await getTestDatabase();
    const questData = await recordOnboardingTask({
      client,
      userId: USER_ID,
      task: "bank_deposit",
    });
    const goal = (trackers: typeof questData) =>
      trackers
        ?.find((tracker) => tracker.id === "deposit-quest")
        ?.goals.find((entry) => entry.id === "bank_deposit");
    expect(goal(questData)?.value).toBe(1);
    const saved = (await requireUser(USER_ID)).questData;
    expect(goal(saved)?.value).toBe(1);
    expect(saved?.find((tracker) => tracker.id === unloadedTracker.id)).toEqual(
      unloadedTracker as never,
    );
  });

  it("writes nothing when no quest asks for the task", async () => {
    await seed();
    const client = await getTestDatabase();
    const { result, statements } = await recordQueries(() =>
      recordOnboardingTask({ client, userId: USER_ID, task: "feed_pet" }),
    );
    expect(result).toBeUndefined();
    const writes = statements.filter((statement) => !/^\s*select\b/i.test(statement));
    expect(writes.filter((statement) => /userdata/i.test(statement))).toEqual([]);
  });

  it("skips the quest read when no story quest has an open goal", async () => {
    await seed();
    const { client, reads } = countingClient(await getTestDatabase());
    const questData = [
      unloadedTracker,
      { id: "unrelated-daily", goals: [{ id: "goal", done: false, value: 0 }] },
    ] as UserData["questData"];
    await expect(
      recordOnboardingTask({
        client,
        userId: USER_ID,
        task: "bank_deposit",
        questData,
      }),
    ).resolves.toBeUndefined();
    expect(reads()).toBe(0);
  });

  it.each([
    ["a story chapter", BLACKSTEEL_CHAPTERS[0].questId],
    ...ONBOARDING_DAILY_QUEST_IDS.map((id) => ["an onboarding daily", id]),
  ])("records the task for a player on %s (%s)", async (_label, questId) => {
    await insertUsers([
      {
        userId: USER_ID,
        username: "Onboarder",
        status: "AWAKE",
        rank: "CHUNIN",
        level: 30,
        questData: [],
      } as never,
    ]);
    await insertUserVotes([{ userId: USER_ID }]);
    await insertQuests([
      { id: questId, content: { objectives: [objective("bank_deposit", 2)] as never } },
    ]);
    await insertQuestHistory([{ userId: USER_ID, questId }]);
    const questData = [
      { id: questId, goals: [{ id: "bank_deposit", done: false, value: 0 }] },
    ] as UserData["questData"];
    const recorded = await recordOnboardingTask({
      client: await getTestDatabase(),
      userId: USER_ID,
      task: "bank_deposit",
      questData,
    });
    const goal = recorded
      ?.find((tracker) => tracker.id === questId)
      ?.goals.find((entry) => entry.id === "bank_deposit");
    expect(goal?.value).toBe(1);
  });
});

/** Wrap the client so a test can tell whether anything touched the database. */
const countingClient = (database: DrizzleClient) => {
  let count = 0;
  const client = new Proxy(database, {
    get: (target, property, receiver) => {
      count++;
      return Reflect.get(target, property, receiver);
    },
  });
  return { client, reads: () => count };
};
